export function normalizeSales(rows) {
  if (!Array.isArray(rows) || rows.length < 1 || rows.length > 10_000) throw new Error("Upload between 1 and 10,000 sales lines.");
  return rows.map((r, i) => {
    const row = {
      event_name: String(r.event_name || "Sales session").trim().slice(0, 100),
      order_id: String(r.order_id || "").trim().slice(0, 100),
      sold_at: String(r.sold_at || "").trim().slice(0, 40),
      product_name: String(r.product_name || "").trim().slice(0, 120),
      category: String(r.category || "").trim().slice(0, 80),
      quantity: Number(r.quantity),
      unit_price_usd: Number(r.unit_price_usd),
      unit_cost_usd: r.unit_cost_usd === "" || r.unit_cost_usd == null ? null : Number(r.unit_cost_usd),
    };
    if (!row.order_id || !row.product_name || !row.category || !Number.isFinite(Date.parse(row.sold_at)) || !Number.isInteger(row.quantity) || row.quantity < 1 || !Number.isFinite(row.unit_price_usd) || row.unit_price_usd < 0 || (row.unit_cost_usd !== null && (!Number.isFinite(row.unit_cost_usd) || row.unit_cost_usd < 0))) {
      throw new Error(`Sales line ${i + 1} has missing or invalid values. Check order, date, product, category, quantity, and USD amounts.`);
    }
    return row;
  });
}

function round2(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }

export function analyze(rows) {
  const sum = (items, fn) => items.reduce((total, item) => total + fn(item), 0);
  const revenue = sum(rows, (r) => r.quantity * r.unit_price_usd);
  const units = sum(rows, (r) => r.quantity);
  const orderIds = new Set(rows.map((r) => r.order_id));
  const below50Units = sum(rows.filter((r) => r.unit_price_usd < 50), (r) => r.quantity);
  const bands = [
    ["under_25", (r) => r.unit_price_usd < 25],
    ["25_to_49_99", (r) => r.unit_price_usd >= 25 && r.unit_price_usd < 50],
    ["50_to_99_99", (r) => r.unit_price_usd >= 50 && r.unit_price_usd < 100],
    ["100_plus", (r) => r.unit_price_usd >= 100],
  ].map(([name, test]) => {
    const group = rows.filter(test);
    const bandUnits = sum(group, (r) => r.quantity);
    const bandRevenue = sum(group, (r) => r.quantity * r.unit_price_usd);
    return { band: name, units: bandUnits, unit_share_pct: round2(units ? bandUnits / units * 100 : 0), revenue_usd: round2(bandRevenue), revenue_share_pct: round2(revenue ? bandRevenue / revenue * 100 : 0) };
  });
  const groupBy = (keyFn) => {
    const map = new Map();
    for (const row of rows) {
      const key = keyFn(row) || "Uncategorized";
      const item = map.get(key) || { name: key, units: 0, revenue_usd: 0, order_ids: new Set() };
      item.units += row.quantity;
      item.revenue_usd += row.quantity * row.unit_price_usd;
      item.order_ids.add(row.order_id);
      map.set(key, item);
    }
    return [...map.values()].map((g) => ({ name: g.name, units: g.units, unit_share_pct: round2(units ? g.units / units * 100 : 0), revenue_usd: round2(g.revenue_usd), revenue_share_pct: round2(revenue ? g.revenue_usd / revenue * 100 : 0), orders: g.order_ids.size }));
  };
  const categories = groupBy((r) => r.category).sort((a, b) => b.revenue_usd - a.revenue_usd);
  const products = groupBy((r) => r.product_name).sort((a, b) => b.revenue_usd - a.revenue_usd).slice(0, 20);
  const costKnown = rows.every((r) => r.unit_cost_usd !== null);
  const grossProfit = costKnown ? sum(rows, (r) => r.quantity * (r.unit_price_usd - r.unit_cost_usd)) : null;
  const dates = rows.map((r) => new Date(r.sold_at)).sort((a, b) => a - b);
  return {
    source: "User-uploaded sales CSV",
    events: [...new Set(rows.map((r) => r.event_name))],
    date_range: { start: dates[0].toISOString().slice(0, 10), end: dates.at(-1).toISOString().slice(0, 10) },
    order_count: orderIds.size,
    line_count: rows.length,
    units_sold: units,
    revenue_usd: round2(revenue),
    average_order_value_usd: round2(revenue / orderIds.size),
    units_under_50_usd: below50Units,
    unit_share_under_50_pct: round2(units ? below50Units / units * 100 : 0),
    price_bands: bands,
    category_performance: categories,
    product_performance_top_20: products,
    gross_profit_usd: grossProfit === null ? null : round2(grossProfit),
    gross_margin_pct: grossProfit === null || revenue === 0 ? null : round2(grossProfit / revenue * 100),
    limitations: ["Revenue uses quantity × unit price and does not subtract discounts unless the export reflects the net unit price.", ...(costKnown ? [] : ["Unit costs are missing on at least one row; gross profit and margin are unavailable."]), "Imported sales are not independently verified against payment records."],
  };
}
