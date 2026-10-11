import test from "node:test";
import assert from "node:assert/strict";
import { analyze, normalizeSales } from "../analytics.js";

const sample = [
  { order_id: "A", sold_at: "2026-10-10", product_name: "Tee", category: "Shirts", quantity: "9", unit_price_usd: "20", unit_cost_usd: "8" },
  { order_id: "B", sold_at: "2026-10-10", product_name: "Jacket", category: "Outerwear", quantity: "1", unit_price_usd: "60", unit_cost_usd: "40" },
];

test("computes unit and category revenue shares from uploaded rows", () => {
  const rows = normalizeSales(sample);
  const metrics = analyze(rows);
  assert.equal(metrics.units_sold, 10);
  assert.equal(metrics.unit_share_under_50_pct, 90);
  assert.equal(metrics.revenue_usd, 240);
  assert.equal(metrics.average_order_value_usd, 120);
  assert.equal(metrics.category_performance[0].name, "Shirts");
  assert.equal(metrics.category_performance[0].revenue_share_pct, 75);
  assert.equal(metrics.gross_profit_usd, 128);
});

test("does not report profit if any product cost is missing", () => {
  const rows = normalizeSales(sample.map((row) => ({ ...row, unit_cost_usd: "" })));
  const metrics = analyze(rows);
  assert.equal(metrics.gross_profit_usd, null);
  assert.equal(metrics.gross_margin_pct, null);
});

test("rejects invalid quantity and missing order identifier", () => {
  assert.throws(() => normalizeSales([{ ...sample[0], quantity: "1.2" }]), /invalid values/i);
  assert.throws(() => normalizeSales([{ ...sample[0], order_id: "" }]), /invalid values/i);
});
