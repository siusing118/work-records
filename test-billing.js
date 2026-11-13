#!/usr/bin/env node
"use strict";
const assert = require("assert");
const {
  computeAmount,
  yearMonthBounds,
  monthTotals,
  buildRecordFields,
  ratesFromEmployee,
} = require("./billing.js");

function check(name, fn) {
  try {
    fn();
    console.log("ok  " + name);
  } catch (e) {
    console.error("FAIL  " + name);
    console.error("  " + e.message);
    process.exitCode = 1;
  }
}

check("hourly 8×60=480", () => {
  assert.strictEqual(computeAmount("hourly", 8, 60), 480.0);
});
check("job 3×150=450", () => {
  assert.strictEqual(computeAmount("job", 3, 150), 450.0);
});
check("OT 2.5×90=225", () => {
  assert.strictEqual(computeAmount("ot", 2.5, 90), 225.0);
});
check("other 50+30×2=110", () => {
  assert.strictEqual(computeAmount("other", 2, 30, 50), 110.0);
});
check("other flat only", () => {
  assert.strictEqual(computeAmount("other", 0, 0, 80), 80.0);
});
check("other rate×qty", () => {
  assert.strictEqual(computeAmount("other", 4, 25, 0), 100.0);
});
check("round half-up 1.5×33.33=50.00", () => {
  assert.strictEqual(computeAmount("hourly", 1.5, 33.33), 50.0);
});
check("unknown type throws", () => {
  assert.throws(() => computeAmount("bonus", 1, 10), /unknown billing_type/);
});

check("yearMonthBounds 2026-11", () => {
  const b = yearMonthBounds("2026-11");
  assert.strictEqual(b.period_start, "2026-11-01");
  assert.strictEqual(b.period_end, "2026-11-30");
});
check("yearMonthBounds leap Feb", () => {
  const b = yearMonthBounds("2028-02");
  assert.strictEqual(b.period_end, "2028-02-29");
});

const employees = [
  { id: 1, employee_code: "T001", name: "測試甲", hourly_rate: 60, job_rate: 150, ot_hourly_rate: 90, other_rate: 30, other_flat_amount: 50, other_name: "車津" },
  { id: 2, employee_code: "T002", name: "測試乙", hourly_rate: 50 },
];
const records = [
  { id: 1, employee_id: 1, work_date: "2026-11-02", billing_type: "hourly", quantity: 8, unit_rate: 60, flat_amount: 0, amount: 480, counted: 1 },
  { id: 2, employee_id: 1, work_date: "2026-11-03", billing_type: "job", quantity: 3, unit_rate: 150, flat_amount: 0, amount: 450, counted: 1 },
  { id: 3, employee_id: 1, work_date: "2026-11-04", billing_type: "ot", quantity: 2.5, unit_rate: 90, flat_amount: 0, amount: 225, counted: 1 },
  { id: 4, employee_id: 1, work_date: "2026-11-05", billing_type: "other", quantity: 2, unit_rate: 30, flat_amount: 50, amount: 110, counted: 1 },
  { id: 5, employee_id: 1, work_date: "2026-11-06", billing_type: "hourly", quantity: 8, unit_rate: 60, flat_amount: 0, amount: 480, counted: 0 },
  { id: 6, employee_id: 1, work_date: "2026-10-20", billing_type: "hourly", quantity: 8, unit_rate: 60, flat_amount: 0, amount: 480, counted: 1 },
  { id: 7, employee_id: 2, work_date: "2026-11-02", billing_type: "hourly", quantity: 4, unit_rate: 50, flat_amount: 0, amount: 200, counted: 1 },
];

check("november totals 1265 + 200 = 1465", () => {
  const data = monthTotals(employees, records, "2026-11");
  assert.strictEqual(data.period_start, "2026-11-01");
  assert.strictEqual(data.period_end, "2026-11-30");
  const a = data.employees.find((e) => e.employee_code === "T001");
  assert.strictEqual(a.amount_hourly, 480.0);
  assert.strictEqual(a.amount_job, 450.0);
  assert.strictEqual(a.amount_ot, 225.0);
  assert.strictEqual(a.amount_other, 110.0);
  assert.strictEqual(a.line_total, 1265.0);
  assert.strictEqual(a.record_count, 4);
  const b = data.employees.find((e) => e.employee_code === "T002");
  assert.strictEqual(b.line_total, 200.0);
  assert.strictEqual(data.grand_total, 1465.0);
  assert.strictEqual(data.totals.amount_hourly, 680.0);
  assert.strictEqual(data.totals.record_count, 5);
});

check("void hourly leaves 785.00 for T001-only set", () => {
  const only = records.filter((r) => r.employee_id === 1 && r.work_date.startsWith("2026-11") && r.counted === 1);
  const full = monthTotals(employees, only, "2026-11");
  assert.strictEqual(full.grand_total, 1265.0);
  const voided = only.map((r) => (r.billing_type === "hourly" ? { ...r, counted: 0 } : r));
  const after = monthTotals(employees, voided, "2026-11");
  assert.strictEqual(after.grand_total, 785.0);
});

check("empty month", () => {
  const data = monthTotals(employees, records, "2026-12");
  assert.strictEqual(data.grand_total, 0);
  assert.deepStrictEqual(data.employees, []);
});

check("snapshot: later rate change does not affect stored amount", () => {
  const emp = { ...employees[0] };
  const snap = ratesFromEmployee(emp, "hourly");
  const rec = buildRecordFields({
    billing_type: "hourly",
    quantity: 8,
    unit_rate: snap.unit_rate,
    flat_amount: 0,
  });
  assert.strictEqual(rec.amount, 480.0);
  assert.strictEqual(rec.unit_rate, 60);
  emp.hourly_rate = 80;
  assert.strictEqual(rec.amount, 480.0);
  assert.strictEqual(rec.unit_rate, 60);
  const later = monthTotals(
    [emp],
    [{ id: 1, employee_id: 1, work_date: "2026-11-02", counted: 1, ...rec }],
    "2026-11"
  );
  assert.strictEqual(later.grand_total, 480.0);
});

check("form override is what gets snapshotted", () => {
  const rec = buildRecordFields({
    billing_type: "job",
    quantity: 2,
    unit_rate: 200, // override vs 150
    flat_amount: 0,
  });
  assert.strictEqual(rec.unit_rate, 200);
  assert.strictEqual(rec.amount, 400.0);
});

if (process.exitCode) {
  console.error("\nSome tests failed.");
  process.exit(1);
}
console.log("\nAll billing tests passed.");
