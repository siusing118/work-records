/* 員工工作紀錄 — 瀏覽器本地版（localStorage） */
(() => {
  const Billing = window.WorkRecordsBilling;
  if (!Billing) {
    console.error("billing.js 未載入");
    return;
  }

  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];

  const STORAGE_KEY = "work-records-v1";
  const HINT_KEY = "work-records-hint-dismissed";

  const BILLING_LABEL = {
    hourly: "時薪",
    job: "單 job",
    ot: "OT",
    other: "其他",
  };
  const QTY_LABEL = {
    hourly: "時數",
    job: "工作件數",
    ot: "OT 時數",
    other: "數量",
  };
  const RATE_LABEL = {
    hourly: "時薪",
    job: "單 job 收費",
    ot: "OT 時薪",
    other: "單價",
  };

  let state = emptyState();
  let modalSaveHandler = null;

  function emptyState() {
    return {
      version: 1,
      employees: [],
      records: [],
      nextEmployeeId: 1,
      nextRecordId: 1,
    };
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return emptyState();
      const data = JSON.parse(raw);
      if (!data || data.version !== 1 || !Array.isArray(data.employees) || !Array.isArray(data.records)) {
        return emptyState();
      }
      const maxEmp = data.employees.reduce((m, e) => Math.max(m, Number(e.id) || 0), 0);
      const maxRec = data.records.reduce((m, r) => Math.max(m, Number(r.id) || 0), 0);
      return {
        version: 1,
        employees: data.employees,
        records: data.records,
        nextEmployeeId: Math.max(Number(data.nextEmployeeId) || 1, maxEmp + 1),
        nextRecordId: Math.max(Number(data.nextRecordId) || 1, maxRec + 1),
      };
    } catch {
      return emptyState();
    }
  }

  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function toast(msg, type = "error") {
    const wrap = $("#toasts");
    const el = document.createElement("div");
    el.className = `toast ${type}`;
    el.textContent = msg;
    wrap.appendChild(el);
    setTimeout(() => el.remove(), 4200);
  }

  function esc(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function money(n) {
    if (n == null || n === "") return "—";
    return Number(n).toLocaleString("zh-HK", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }

  function todayHK() {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Hong_Kong",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
  }

  function currentYearMonth() {
    return todayHK().slice(0, 7);
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function employeesSorted() {
    return [...state.employees].sort((a, b) =>
      String(a.employee_code || "").localeCompare(String(b.employee_code || ""), "zh-Hant")
    );
  }

  function empById(id) {
    return state.employees.find((x) => x.id === Number(id));
  }

  function empName(id) {
    const e = empById(id);
    return e ? `${e.employee_code} ${e.name}` : `#${id}`;
  }

  function fillEmployeeSelect(sel, includeAll = true, selected = "") {
    const opts = [];
    if (includeAll) opts.push(`<option value="">全部</option>`);
    for (const e of employeesSorted()) {
      opts.push(
        `<option value="${e.id}" ${String(e.id) === String(selected) ? "selected" : ""}>${esc(
          e.employee_code
        )} · ${esc(e.name)}</option>`
      );
    }
    sel.innerHTML = opts.join("");
  }

  function openModal(title, bodyHtml, onSave) {
    $("#modal-title").textContent = title;
    $("#modal-body").innerHTML = bodyHtml;
    modalSaveHandler = onSave;
    $("#modal").classList.add("open");
  }

  function closeModal() {
    $("#modal").classList.remove("open");
    modalSaveHandler = null;
  }

  function readForm(container) {
    const data = {};
    $$("input, select, textarea", container).forEach((el) => {
      if (!el.name) return;
      let v = el.value;
      if (el.type === "number") {
        v = v === "" ? null : Number(v);
      } else if (v === "") {
        v = null;
      }
      data[el.name] = v;
    });
    return data;
  }

  function switchTab(name) {
    $$(".tabs button").forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
    $$(".panel").forEach((p) => p.classList.toggle("active", p.id === `panel-${name}`));
    if (name === "employees") loadEmployees();
    if (name === "records") {
      fillEmployeeSelect($("#rec-employee"), true, $("#rec-employee").value);
      loadRecords();
    }
    if (name === "rates") loadRates();
    if (name === "totals") loadTotals();
  }

  function loadEmployees() {
    const q = $("#emp-q").value.trim().toLowerCase();
    const status = $("#emp-status").value;
    const filtered = employeesSorted().filter((e) => {
      if (status && e.status !== status) return false;
      if (q) {
        const hay = `${e.employee_code} ${e.name}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    renderEmployees(filtered);
  }

  function renderEmployees(list) {
    const tbody = $("#emp-tbody");
    if (!list.length) {
      tbody.innerHTML = `<tr><td colspan="7" class="empty">暫無員工</td></tr>`;
      return;
    }
    tbody.innerHTML = list
      .map(
        (e) => `<tr>
      <td data-label="編號">${esc(e.employee_code)}</td>
      <td data-label="姓名">${esc(e.name)}</td>
      <td data-label="入職">${esc(e.hire_date)}</td>
      <td data-label="狀態"><span class="badge ${esc(e.status)}">${e.status === "inactive" ? "停用" : "在職"}</span></td>
      <td data-label="部門">${esc(e.dept || "—")}</td>
      <td data-label="職稱">${esc(e.title || "—")}</td>
      <td class="actions">
        <button class="btn sm ghost" data-edit-emp="${e.id}">編輯</button>
      </td>
    </tr>`
      )
      .join("");
  }

  function employeeForm(existing = null) {
    const e = existing || {};
    return `
      <div class="form-grid">
        <div class="field"><label>員工編號 *</label>
          <input name="employee_code" value="${esc(e.employee_code || "")}" ${existing ? "readonly" : ""} required /></div>
        <div class="field"><label>姓名 *</label>
          <input name="name" value="${esc(e.name || "")}" required /></div>
        <div class="field"><label>入職日期 *</label>
          <input type="date" name="hire_date" value="${esc(e.hire_date || todayHK())}" required /></div>
        <div class="field"><label>離職日期</label>
          <input type="date" name="terminate_date" value="${esc(e.terminate_date || "")}" /></div>
        <div class="field"><label>狀態</label>
          <select name="status">
            <option value="active" ${e.status !== "inactive" ? "selected" : ""}>在職</option>
            <option value="inactive" ${e.status === "inactive" ? "selected" : ""}>停用</option>
          </select></div>
        <div class="field"><label>部門</label>
          <input name="dept" value="${esc(e.dept || "")}" /></div>
        <div class="field"><label>職稱</label>
          <input name="title" value="${esc(e.title || "")}" /></div>
        <div class="field full"><label>備註（可選）</label>
          <input name="bank_name" value="${esc(e.bank_name || "")}" placeholder="可留空" /></div>
      </div>`;
  }

  function openEmployeeModal(existing = null) {
    openModal(existing ? `編輯員工 #${existing.id}` : "新增員工", employeeForm(existing), () => {
      const data = readForm($("#modal-body"));
      if (!data.employee_code || !data.name || !data.hire_date) {
        toast("請填編號、姓名、入職日期");
        return;
      }
      const code = String(data.employee_code).trim();
      if (existing) {
        const idx = state.employees.findIndex((x) => x.id === existing.id);
        if (idx === -1) {
          toast("找不到此員工");
          return;
        }
        state.employees[idx] = {
          ...state.employees[idx],
          name: String(data.name).trim(),
          hire_date: data.hire_date,
          terminate_date: data.terminate_date,
          status: data.status || "active",
          dept: data.dept,
          title: data.title,
          bank_name: data.bank_name,
          updated_at: nowIso(),
        };
        saveState();
        toast("已更新員工", "ok");
      } else {
        const clash = state.employees.some(
          (e) => String(e.employee_code).toLowerCase() === code.toLowerCase()
        );
        if (clash) {
          toast("員工編號已存在");
          return;
        }
        state.employees.push({
          id: state.nextEmployeeId++,
          employee_code: code,
          name: String(data.name).trim(),
          hire_date: data.hire_date,
          terminate_date: data.terminate_date,
          status: data.status || "active",
          dept: data.dept,
          title: data.title,
          bank_name: data.bank_name,
          hourly_rate: null,
          job_rate: null,
          ot_hourly_rate: null,
          other_name: null,
          other_rate: null,
          other_flat_amount: null,
          created_at: nowIso(),
          updated_at: nowIso(),
        });
        saveState();
        toast("已新增員工", "ok");
      }
      closeModal();
      loadEmployees();
    });
  }

  function loadRecords() {
    fillEmployeeSelect($("#rec-employee"), true, $("#rec-employee").value);
    const emp = $("#rec-employee").value;
    const from = $("#rec-from").value;
    const to = $("#rec-to").value;
    const billing = $("#rec-billing").value;
    const counted = $("#rec-counted").value;
    const list = state.records
      .filter((r) => {
        if (emp && String(r.employee_id) !== String(emp)) return false;
        if (from && r.work_date < from) return false;
        if (to && r.work_date > to) return false;
        if (billing && r.billing_type !== billing) return false;
        if (counted !== "" && String(Number(r.counted) === 1 ? 1 : 0) !== counted) return false;
        return true;
      })
      .sort((a, b) => {
        if (a.work_date !== b.work_date) return a.work_date < b.work_date ? 1 : -1;
        return b.id - a.id;
      });
    renderRecords(list);
  }

  function renderRecords(list) {
    const tbody = $("#rec-tbody");
    if (!list.length) {
      tbody.innerHTML = `<tr><td colspan="9" class="empty">暫無紀錄</td></tr>`;
      return;
    }
    tbody.innerHTML = list
      .map((r) => {
        const type = r.billing_type || "";
        const typeLabel = BILLING_LABEL[type] || "—";
        const counted = Number(r.counted) === 1;
        const nameBit = r.other_name ? `<div class="sub">${esc(r.other_name)}</div>` : "";
        const noteBit = r.note ? `<div class="sub">${esc(r.note)}</div>` : "";
        return `<tr class="${counted ? "" : "row-voided"}">
        <td data-label="日期">${esc(r.work_date)}<div class="sub">#${r.id}</div>${noteBit}</td>
        <td data-label="員工">${esc(empName(r.employee_id))}</td>
        <td data-label="類型">${esc(typeLabel)}${nameBit}</td>
        <td data-label="數量">${r.quantity != null ? esc(r.quantity) : "—"}</td>
        <td data-label="單價" class="money">${money(r.unit_rate)}</td>
        <td data-label="固定額" class="money">${type === "other" ? money(r.flat_amount) : "—"}</td>
        <td data-label="金額" class="money">${money(r.amount)}</td>
        <td data-label="狀態">${
          counted
            ? '<span class="badge confirmed">計入總數</span>'
            : '<span class="badge voided">已作廢</span>'
        }</td>
        <td class="actions">
          <button class="btn sm ghost" data-edit-rec="${r.id}">編輯</button>
          ${
            counted
              ? `<button class="btn sm warn" data-void-rec="${r.id}">作廢</button>`
              : `<button class="btn sm ok" data-restore-rec="${r.id}">恢復計入</button>`
          }
          <button class="btn sm danger" data-del-rec="${r.id}">刪除</button>
        </td>
      </tr>`;
      })
      .join("");
  }

  function recordForm(existing = null) {
    const r = existing || {};
    const empOpts = employeesSorted()
      .map(
        (e) =>
          `<option value="${e.id}" ${Number(r.employee_id) === e.id ? "selected" : ""}>${esc(
            e.employee_code
          )} · ${esc(e.name)}</option>`
      )
      .join("");
    const bt = r.billing_type || "hourly";
    return `
      <div class="form-grid">
        <div class="field"><label>員工 *</label>
          <select name="employee_id" id="f-rec-emp" ${existing ? "disabled" : ""} required>${empOpts}</select></div>
        <div class="field"><label>工作日期 *</label>
          <input type="date" name="work_date" id="f-rec-date" value="${esc(r.work_date || todayHK())}" required /></div>
        <div class="field"><label>計費類型 *</label>
          <select name="billing_type" id="f-billing">
            <option value="hourly" ${bt === "hourly" ? "selected" : ""}>時薪</option>
            <option value="job" ${bt === "job" ? "selected" : ""}>單 job 收費</option>
            <option value="ot" ${bt === "ot" ? "selected" : ""}>OT</option>
            <option value="other" ${bt === "other" ? "selected" : ""}>其他</option>
          </select></div>
        <div class="field" id="f-other-name-wrap">
          <label>其他名稱</label>
          <input name="other_name" id="f-other-name" value="${esc(r.other_name || "")}" placeholder="例如車津、獎金" />
        </div>
        <div class="field">
          <label id="f-qty-label">${QTY_LABEL[bt] || "數量"}</label>
          <input type="number" step="0.25" min="0" name="quantity" id="f-quantity" inputmode="decimal" value="${
            r.quantity != null ? esc(r.quantity) : ""
          }" />
        </div>
        <div class="field">
          <label id="f-rate-label">${RATE_LABEL[bt] || "單價"}</label>
          <input type="number" step="0.01" min="0" name="unit_rate" id="f-unit-rate" inputmode="decimal" value="${
            r.unit_rate != null ? esc(r.unit_rate) : ""
          }" />
        </div>
        <div class="field" id="f-flat-wrap">
          <label>固定金額</label>
          <input type="number" step="0.01" name="flat_amount" id="f-flat-amount" inputmode="decimal" value="${
            r.flat_amount != null ? esc(r.flat_amount) : ""
          }" />
        </div>
        <div class="field full"><label>備註</label>
          <textarea name="note">${esc(r.note || "")}</textarea></div>
      </div>
      <p class="amount-preview" id="f-amount-preview">金額：—</p>
      <p class="sub" style="margin-top:4px">單價會先帶入該員工當時收費設定，可喺呢度改；儲存後會鎖定喺呢筆記錄。</p>`;
  }

  function updateAmountPreview() {
    const el = $("#f-amount-preview");
    if (!el) return;
    const type = $("#f-billing")?.value || "hourly";
    const qty = $("#f-quantity")?.value;
    const rate = $("#f-unit-rate")?.value;
    const flat = $("#f-flat-amount")?.value;
    const amt = Billing.computeAmount(type, qty, rate, type === "other" ? flat : 0);
    el.textContent = `金額：HK$ ${money(amt)}`;
  }

  function syncRecordFormFields() {
    const type = $("#f-billing")?.value || "hourly";
    const qtyLabel = $("#f-qty-label");
    const rateLabel = $("#f-rate-label");
    if (qtyLabel) qtyLabel.textContent = QTY_LABEL[type] || "數量";
    if (rateLabel) rateLabel.textContent = RATE_LABEL[type] || "單價";
    const otherWrap = $("#f-other-name-wrap");
    const flatWrap = $("#f-flat-wrap");
    if (otherWrap) otherWrap.style.display = type === "other" ? "" : "none";
    if (flatWrap) flatWrap.style.display = type === "other" ? "" : "none";
    updateAmountPreview();
  }

  function fillRatesIntoForm(force = false) {
    const empId = $("#f-rec-emp")?.value;
    const type = $("#f-billing")?.value;
    if (!empId || !type) return;
    const emp = empById(empId);
    if (!emp) return;
    const rates = Billing.ratesFromEmployee(emp, type);
    const rateEl = $("#f-unit-rate");
    const flatEl = $("#f-flat-amount");
    const nameEl = $("#f-other-name");
    if (!rateEl) return;
    if (force || rateEl.value === "") {
      rateEl.value = rates.unit_rate != null && rates.unit_rate !== "" ? rates.unit_rate : "";
    }
    if (type === "other") {
      if (force || (flatEl && flatEl.value === "")) {
        if (flatEl) flatEl.value = rates.flat_amount != null && rates.flat_amount !== "" ? rates.flat_amount : "";
      }
      if (force || (nameEl && !nameEl.value)) {
        if (nameEl) nameEl.value = rates.other_name || "";
      }
    }
    updateAmountPreview();
  }

  function openRecordModal(existing = null) {
    if (!state.employees.length) {
      toast("請先新增員工");
      return;
    }
    openModal(existing ? `編輯紀錄 #${existing.id}` : "新增工作紀錄", recordForm(existing), () => {
      const data = readForm($("#modal-body"));
      const employeeId = Number(existing ? existing.employee_id : data.employee_id);
      if (!data.work_date || !data.billing_type) {
        toast("請填日期同計費類型");
        return;
      }
      if (data.billing_type !== "other") {
        data.flat_amount = 0;
        data.other_name = null;
      }
      let fields;
      try {
        fields = Billing.buildRecordFields({
          billing_type: data.billing_type,
          quantity: data.quantity,
          unit_rate: data.unit_rate,
          flat_amount: data.flat_amount,
          other_name: data.other_name,
        });
      } catch (err) {
        toast(err.message || "無法計算金額");
        return;
      }
      if (existing) {
        const idx = state.records.findIndex((x) => x.id === existing.id);
        if (idx === -1) {
          toast("找不到此紀錄");
          return;
        }
        state.records[idx] = {
          ...state.records[idx],
          work_date: data.work_date,
          note: data.note,
          ...fields,
          updated_at: nowIso(),
        };
        saveState();
        toast("已更新紀錄", "ok");
      } else {
        state.records.push({
          id: state.nextRecordId++,
          employee_id: employeeId,
          work_date: data.work_date,
          note: data.note,
          counted: 1,
          ...fields,
          created_at: nowIso(),
          updated_at: nowIso(),
        });
        saveState();
        toast("已新增紀錄（已計入總數）", "ok");
      }
      closeModal();
      loadRecords();
    });
    syncRecordFormFields();
    $("#f-billing")?.addEventListener("change", () => {
      syncRecordFormFields();
      fillRatesIntoForm(true);
    });
    $("#f-rec-emp")?.addEventListener("change", () => fillRatesIntoForm(true));
    $("#f-rec-date")?.addEventListener("change", () => fillRatesIntoForm(true));
    ["f-quantity", "f-unit-rate", "f-flat-amount"].forEach((id) => {
      $(`#${id}`)?.addEventListener("input", updateAmountPreview);
    });
    if (!existing) fillRatesIntoForm(true);
    else updateAmountPreview();
  }

  function loadRates() {
    renderRates(employeesSorted());
  }

  function renderRates(list) {
    const tbody = $("#rate-tbody");
    if (!list.length) {
      tbody.innerHTML = `<tr><td colspan="9" class="empty">暫無員工，請先新增員工</td></tr>`;
      return;
    }
    tbody.innerHTML = list
      .map((r) => {
        const unset =
          r.hourly_rate == null &&
          r.job_rate == null &&
          r.ot_hourly_rate == null &&
          r.other_rate == null &&
          r.other_flat_amount == null;
        return `<tr>
        <td data-label="員工">${esc(r.employee_code)} · ${esc(r.name)}</td>
        <td data-label="狀態"><span class="badge ${esc(r.status)}">${r.status === "inactive" ? "停用" : "在職"}</span></td>
        <td data-label="時薪" class="money">${money(r.hourly_rate)}</td>
        <td data-label="單 job 收費" class="money">${money(r.job_rate)}</td>
        <td data-label="OT 時薪" class="money">${money(r.ot_hourly_rate)}</td>
        <td data-label="其他名稱">${esc(r.other_name || "—")}</td>
        <td data-label="其他單價" class="money">${money(r.other_rate)}</td>
        <td data-label="其他固定額" class="money">${money(r.other_flat_amount)}</td>
        <td class="actions">
          <button class="btn sm ${unset ? "secondary" : "ghost"}" data-edit-rate="${r.id}">${
          unset ? "設定" : "編輯"
        }</button>
        </td>
      </tr>`;
      })
      .join("");
  }

  function ratesForm(r) {
    return `
      <div class="form-grid">
        <div class="field"><label>時薪</label>
          <input type="number" step="0.01" min="0" name="hourly_rate" inputmode="decimal" value="${r.hourly_rate ?? ""}" /></div>
        <div class="field"><label>單 job 收費</label>
          <input type="number" step="0.01" min="0" name="job_rate" inputmode="decimal" value="${r.job_rate ?? ""}" /></div>
        <div class="field"><label>OT 時薪</label>
          <input type="number" step="0.01" min="0" name="ot_hourly_rate" inputmode="decimal" value="${r.ot_hourly_rate ?? ""}" /></div>
        <div class="field"><label>其他名稱</label>
          <input name="other_name" value="${esc(r.other_name || "")}" placeholder="例如車津" /></div>
        <div class="field"><label>其他單價</label>
          <input type="number" step="0.01" min="0" name="other_rate" inputmode="decimal" value="${r.other_rate ?? ""}" /></div>
        <div class="field"><label>其他固定額</label>
          <input type="number" step="0.01" name="other_flat_amount" inputmode="decimal" value="${r.other_flat_amount ?? ""}" /></div>
      </div>
      <p class="sub" style="margin-top:8px">「其他」可以只用固定額、只用單價 × 數量，或者兩樣一齊加。已入嘅舊紀錄唔會因呢次修改而改金額。</p>`;
  }

  function openRatesModal(existing) {
    openModal(`收費設定 · ${existing.employee_code} ${existing.name}`, ratesForm(existing), () => {
      const data = readForm($("#modal-body"));
      const idx = state.employees.findIndex((x) => x.id === existing.id);
      if (idx === -1) {
        toast("找不到此員工");
        return;
      }
      state.employees[idx] = {
        ...state.employees[idx],
        hourly_rate: data.hourly_rate,
        job_rate: data.job_rate,
        ot_hourly_rate: data.ot_hourly_rate,
        other_name: data.other_name,
        other_rate: data.other_rate,
        other_flat_amount: data.other_flat_amount,
        updated_at: nowIso(),
      };
      saveState();
      toast("已儲存收費設定", "ok");
      closeModal();
      loadRates();
    });
  }

  function loadTotals() {
    const ym = $("#tot-month").value;
    if (!ym) {
      $("#tot-tbody").innerHTML = `<tr><td colspan="6" class="empty">請選月份後查詢</td></tr>`;
      $("#tot-foot").innerHTML = "";
      return;
    }
    renderTotals(Billing.monthTotals(state.employees, state.records, ym));
  }

  function qtyMoneyCell(label, qty, amount) {
    return `<td data-label="${esc(label)}"><div class="sub">${qty ? esc(qty) : "0"}</div><div class="money">${money(amount)}</div></td>`;
  }

  function renderTotals(data) {
    const tbody = $("#tot-tbody");
    const foot = $("#tot-foot");
    const list = data.employees || [];
    if (!list.length) {
      tbody.innerHTML = `<tr><td colspan="6" class="empty">${esc(data.year_month)} 未有計入嘅紀錄</td></tr>`;
      foot.innerHTML = "";
      return;
    }
    tbody.innerHTML = list
      .map(
        (e) => `<tr>
        <td data-label="員工">${esc(e.employee_code)} · ${esc(e.name)}<div class="sub">${e.record_count} 筆</div></td>
        ${qtyMoneyCell("時薪（時數／額）", e.qty_hourly, e.amount_hourly)}
        ${qtyMoneyCell("單 job（件／額）", e.qty_job, e.amount_job)}
        ${qtyMoneyCell("OT（時數／額）", e.qty_ot, e.amount_ot)}
        ${qtyMoneyCell("其他（數量／額）", e.qty_other, e.amount_other)}
        <td data-label="合計" class="money">${money(e.line_total)}</td>
      </tr>`
      )
      .join("");
    const t = data.totals || {};
    foot.innerHTML = `<tr class="grand-row">
      <td data-label="全部總數">全部總數<div class="sub">${t.record_count || 0} 筆 · ${esc(data.period_start)} → ${esc(
      data.period_end
    )}</div></td>
      ${qtyMoneyCell("時薪（時數／額）", t.qty_hourly, t.amount_hourly)}
      ${qtyMoneyCell("單 job（件／額）", t.qty_job, t.amount_job)}
      ${qtyMoneyCell("OT（時數／額）", t.qty_ot, t.amount_ot)}
      ${qtyMoneyCell("其他（數量／額）", t.qty_other, t.amount_other)}
      <td data-label="合計" class="money grand-total">HK$ ${money(data.grand_total)}</td>
    </tr>`;
  }

  function exportBackup() {
    const payload = {
      version: 1,
      exported_at: nowIso(),
      timezone: "Asia/Hong_Kong",
      employees: state.employees,
      records: state.records,
      nextEmployeeId: state.nextEmployeeId,
      nextRecordId: state.nextRecordId,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `工作紀錄備份-${todayHK()}.json`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 0);
    toast("已匯出備份檔", "ok");
  }

  function validateBackup(data) {
    if (!data || typeof data !== "object") return "備份檔格式不正確";
    if (!Array.isArray(data.employees) || !Array.isArray(data.records)) {
      return "備份檔缺少員工或工作紀錄";
    }
    return null;
  }

  function importBackupFile(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(String(reader.result || ""));
        const err = validateBackup(data);
        if (err) {
          toast(err);
          return;
        }
        const count = data.employees.length + data.records.length;
        const msg =
          `匯入會覆蓋此瀏覽器而家嘅全部資料（員工 ${data.employees.length} 人、紀錄 ${data.records.length} 筆）。確定？`;
        if (!confirm(msg)) return;
        const maxEmp = data.employees.reduce((m, e) => Math.max(m, Number(e.id) || 0), 0);
        const maxRec = data.records.reduce((m, r) => Math.max(m, Number(r.id) || 0), 0);
        state = {
          version: 1,
          employees: data.employees,
          records: data.records,
          nextEmployeeId: Math.max(Number(data.nextEmployeeId) || 1, maxEmp + 1),
          nextRecordId: Math.max(Number(data.nextRecordId) || 1, maxRec + 1),
        };
        saveState();
        loadEmployees();
        loadRecords();
        loadRates();
        loadTotals();
        toast(count ? "已匯入備份" : "已匯入空白備份", "ok");
      } catch {
        toast("無法讀取備份檔，請確認係 JSON");
      }
    };
    reader.onerror = () => toast("讀取檔案失敗");
    reader.readAsText(file, "utf-8");
  }

  function bind() {
    $$(".tabs button").forEach((b) =>
      b.addEventListener("click", () => switchTab(b.dataset.tab))
    );

    $("#modal-close").addEventListener("click", closeModal);
    $("#modal-cancel").addEventListener("click", closeModal);
    $("#modal-save").addEventListener("click", () => {
      if (!modalSaveHandler) return;
      try {
        modalSaveHandler();
      } catch (err) {
        toast(err.message || "儲存失敗");
      }
    });
    $("#modal").addEventListener("click", (e) => {
      if (e.target === $("#modal")) closeModal();
    });

    $("#emp-new").addEventListener("click", () => openEmployeeModal());
    $("#emp-q").addEventListener("input", loadEmployees);
    $("#emp-q").addEventListener("keydown", (e) => {
      if (e.key === "Enter") loadEmployees();
    });
    $("#emp-status").addEventListener("change", loadEmployees);
    $("#emp-tbody").addEventListener("click", (e) => {
      const btn = e.target.closest("[data-edit-emp]");
      if (!btn) return;
      const emp = empById(btn.dataset.editEmp);
      if (emp) openEmployeeModal(emp);
    });

    $("#rec-new").addEventListener("click", () => openRecordModal());
    ["rec-employee", "rec-from", "rec-to", "rec-billing", "rec-counted"].forEach((id) => {
      $(`#${id}`).addEventListener("change", loadRecords);
    });
    $("#rec-tbody").addEventListener("click", (e) => {
      const edit = e.target.closest("[data-edit-rec]");
      const voidBtn = e.target.closest("[data-void-rec]");
      const restore = e.target.closest("[data-restore-rec]");
      const del = e.target.closest("[data-del-rec]");
      if (edit) {
        const rec = state.records.find((r) => r.id === Number(edit.dataset.editRec));
        if (rec) openRecordModal(rec);
      }
      if (voidBtn) {
        if (!confirm("作廢後唔會計入總數（紀錄仍會保留），確定？")) return;
        const rec = state.records.find((r) => r.id === Number(voidBtn.dataset.voidRec));
        if (!rec) return;
        rec.counted = 0;
        rec.updated_at = nowIso();
        saveState();
        toast("已作廢", "ok");
        loadRecords();
      }
      if (restore) {
        const rec = state.records.find((r) => r.id === Number(restore.dataset.restoreRec));
        if (!rec) return;
        rec.counted = 1;
        rec.updated_at = nowIso();
        saveState();
        toast("已恢復計入", "ok");
        loadRecords();
      }
      if (del) {
        if (!confirm("確定刪除此紀錄？此動作無法復原。")) return;
        state.records = state.records.filter((r) => r.id !== Number(del.dataset.delRec));
        saveState();
        toast("已刪除", "ok");
        loadRecords();
      }
    });

    $("#rate-tbody").addEventListener("click", (e) => {
      const btn = e.target.closest("[data-edit-rate]");
      if (!btn) return;
      const emp = empById(btn.dataset.editRate);
      if (emp) openRatesModal(emp);
    });

    $("#tot-refresh").addEventListener("click", loadTotals);
    $("#tot-month").addEventListener("change", loadTotals);
    $("#tot-month").value = currentYearMonth();

    $("#btn-export").addEventListener("click", exportBackup);
    $("#btn-import").addEventListener("click", () => $("#import-file").click());
    $("#import-file").addEventListener("change", (e) => {
      const file = e.target.files && e.target.files[0];
      e.target.value = "";
      if (file) importBackupFile(file);
    });

    const hint = $("#install-hint");
    if (localStorage.getItem(HINT_KEY) === "1") hint.classList.add("hidden");
    $("#dismiss-hint").addEventListener("click", () => {
      localStorage.setItem(HINT_KEY, "1");
      hint.classList.add("hidden");
    });
  }

  state = loadState();
  bind();
  loadEmployees();
  loadTotals();
})();
