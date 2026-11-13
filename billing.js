/* 員工工作紀錄 — 計費邏輯（與 payroll-app Python 版對齊：四捨五入至兩位小數） */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.WorkRecordsBilling = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const BILLING_TYPES = ["hourly", "job", "ot", "other"];

  function toPlainString(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return "0";
    let s = String(n);
    if (/e/i.test(s)) {
      const mag = Math.abs(n);
      const digits = mag >= 1 ? 12 : 20;
      s = mag.toFixed(digits).replace(/0+$/, "").replace(/\.$/, "");
      if (n < 0) s = "-" + s;
    }
    return s;
  }

  /** Python Decimal(str(x)).quantize(Decimal("0.01"), ROUND_HALF_UP) */
  function roundHalfUp(value, places) {
    const p = places == null ? 2 : places;
    const sign = Number(value) < 0 ? -1 : 1;
    const s = toPlainString(Math.abs(Number(value)));
    let [intPart, fracPart = ""] = s.split(".");
    if (!intPart) intPart = "0";
    if (fracPart.length <= p) {
      fracPart = fracPart.padEnd(p, "0");
      const num = Number(intPart + (p ? "." + fracPart : ""));
      return sign * num;
    }
    const keep = fracPart.slice(0, p);
    const next = fracPart.charAt(p);
    let digits = intPart + keep;
    if (next >= "5") {
      const width = digits.length;
      digits = (BigInt(digits) + 1n).toString().padStart(width, "0");
    }
    if (p === 0) return sign * Number(digits);
    const i = digits.length - p;
    const head = digits.slice(0, i) || "0";
    const tail = digits.slice(i);
    return sign * Number(head + "." + tail);
  }

  function computeAmount(billingType, quantity, unitRate, flatAmount) {
    if (BILLING_TYPES.indexOf(billingType) === -1) {
      throw new Error("unknown billing_type: " + billingType);
    }
    const qty = Number(quantity || 0);
    const rate = Number(unitRate || 0);
    const flat = Number(flatAmount || 0);
    const raw = billingType === "other" ? flat + rate * qty : rate * qty;
    return roundHalfUp(raw, 2);
  }

  function yearMonthBounds(yearMonth) {
    const m = /^(\d{4})-(\d{2})$/.exec(String(yearMonth || ""));
    if (!m) throw new Error("invalid year_month");
    const year = Number(m[1]);
    const month = Number(m[2]);
    if (month < 1 || month > 12) throw new Error("invalid year_month");
    const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const pad = (n) => String(n).padStart(2, "0");
    return {
      period_start: year + "-" + pad(month) + "-01",
      period_end: year + "-" + pad(month) + "-" + pad(last),
    };
  }

  function emptyEmpLine(emp) {
    return {
      employee_id: emp.id,
      employee_code: emp.employee_code,
      name: emp.name,
      qty_hourly: 0,
      qty_job: 0,
      qty_ot: 0,
      qty_other: 0,
      amount_hourly: 0,
      amount_job: 0,
      amount_ot: 0,
      amount_other: 0,
      record_count: 0,
      line_total: 0,
    };
  }

  function ratesFromEmployee(emp, billingType) {
    const e = emp || {};
    if (billingType === "hourly") {
      return { unit_rate: e.hourly_rate, flat_amount: 0, other_name: null };
    }
    if (billingType === "job") {
      return { unit_rate: e.job_rate, flat_amount: 0, other_name: null };
    }
    if (billingType === "ot") {
      return { unit_rate: e.ot_hourly_rate, flat_amount: 0, other_name: null };
    }
    if (billingType === "other") {
      return {
        unit_rate: e.other_rate,
        flat_amount: e.other_flat_amount,
        other_name: e.other_name || null,
      };
    }
    return { unit_rate: null, flat_amount: 0, other_name: null };
  }

  /**
   * Build a snapshotted record payload from form values (already the values to lock).
   * Does not look up later rate changes.
   */
  function buildRecordFields(input) {
    const billingType = input.billing_type;
    if (BILLING_TYPES.indexOf(billingType) === -1) {
      throw new Error("請選擇計費類型（時薪／單 job／OT／其他）");
    }
    let quantity = input.quantity == null || input.quantity === "" ? 0 : Number(input.quantity);
    if (!Number.isFinite(quantity)) throw new Error("數量無效");
    if (["hourly", "job", "ot"].indexOf(billingType) !== -1 && quantity < 0) {
      throw new Error("數量不可為負數");
    }
    const unitRate = input.unit_rate == null || input.unit_rate === "" ? 0 : Number(input.unit_rate);
    const flatAmount =
      billingType === "other"
        ? input.flat_amount == null || input.flat_amount === ""
          ? 0
          : Number(input.flat_amount)
        : 0;
    if (!Number.isFinite(unitRate) || !Number.isFinite(flatAmount)) {
      throw new Error("單價或固定額無效");
    }
    const otherName = billingType === "other" ? input.other_name || null : null;
    const amount = computeAmount(billingType, quantity, unitRate, flatAmount);
    return {
      billing_type: billingType,
      quantity,
      unit_rate: unitRate,
      flat_amount: flatAmount,
      other_name: otherName,
      amount,
    };
  }

  function monthTotals(employees, records, yearMonth) {
    const { period_start, period_end } = yearMonthBounds(yearMonth);
    const empMap = {};
    (employees || []).forEach((e) => {
      empMap[e.id] = e;
    });
    const byEmp = {};
    (records || []).forEach((rec) => {
      if (Number(rec.counted) !== 1) return;
      const d = rec.work_date;
      if (!d || d < period_start || d > period_end) return;
      const bt = rec.billing_type;
      if (BILLING_TYPES.indexOf(bt) === -1) return;
      const emp = empMap[rec.employee_id];
      if (!emp) return;
      if (!byEmp[emp.id]) byEmp[emp.id] = emptyEmpLine(emp);
      const line = byEmp[emp.id];
      const qty = rec.quantity == null ? 0 : Number(rec.quantity);
      const amt =
        rec.amount == null
          ? computeAmount(bt, qty, rec.unit_rate || 0, rec.flat_amount || 0)
          : Number(rec.amount);
      line.record_count += 1;
      line["qty_" + bt] = roundHalfUp(line["qty_" + bt] + qty, 4);
      line["amount_" + bt] = roundHalfUp(line["amount_" + bt] + amt, 2);
      line.line_total = roundHalfUp(line.line_total + amt, 2);
    });
    const list = Object.keys(byEmp)
      .map((k) => byEmp[k])
      .sort((a, b) => String(a.employee_code || "").localeCompare(String(b.employee_code || ""), "zh-Hant"));
    const totals = {
      amount_hourly: roundHalfUp(list.reduce((s, e) => s + e.amount_hourly, 0), 2),
      amount_job: roundHalfUp(list.reduce((s, e) => s + e.amount_job, 0), 2),
      amount_ot: roundHalfUp(list.reduce((s, e) => s + e.amount_ot, 0), 2),
      amount_other: roundHalfUp(list.reduce((s, e) => s + e.amount_other, 0), 2),
      qty_hourly: roundHalfUp(list.reduce((s, e) => s + e.qty_hourly, 0), 4),
      qty_job: roundHalfUp(list.reduce((s, e) => s + e.qty_job, 0), 4),
      qty_ot: roundHalfUp(list.reduce((s, e) => s + e.qty_ot, 0), 4),
      qty_other: roundHalfUp(list.reduce((s, e) => s + e.qty_other, 0), 4),
      record_count: list.reduce((s, e) => s + e.record_count, 0),
      grand_total: roundHalfUp(list.reduce((s, e) => s + e.line_total, 0), 2),
    };
    return {
      year_month: yearMonth,
      period_start,
      period_end,
      employees: list,
      totals,
      grand_total: totals.grand_total,
      currency: "HKD",
    };
  }

  return {
    BILLING_TYPES,
    roundHalfUp,
    computeAmount,
    yearMonthBounds,
    ratesFromEmployee,
    buildRecordFields,
    monthTotals,
  };
});
