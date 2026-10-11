const $ = (selector) => document.querySelector(selector);
const money = (value) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(value) || 0);
let salesRows = [];
let history = [];

function parseCsv(text) {
  const rows = [];
  let row = [], value = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted && char === '"' && text[i + 1] === '"') { value += '"'; i++; }
    else if (char === '"') quoted = !quoted;
    else if (char === "," && !quoted) { row.push(value); value = ""; }
    else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && text[i + 1] === "\n") i++;
      row.push(value); if (row.some((cell) => cell.trim())) rows.push(row); row = []; value = "";
    } else value += char;
  }
  row.push(value); if (row.some((cell) => cell.trim())) rows.push(row);
  if (rows.length < 2) throw new Error("CSV needs a header row and at least one sales line.");
  const headers = rows.shift().map((x) => x.replace(/^\uFEFF/, "").trim().toLowerCase());
  const required = ["order_id", "sold_at", "product_name", "category", "quantity", "unit_price_usd"];
  const missing = required.filter((name) => !headers.includes(name));
  if (missing.length) throw new Error(`Missing columns: ${missing.join(", ")}`);
  return rows.map((cells, index) => {
    const record = Object.fromEntries(headers.map((header, i) => [header, (cells[i] || "").trim()]));
    const result = {
      event_name: record.event_name || "Sales session", order_id: record.order_id,
      sold_at: record.sold_at, product_name: record.product_name, category: record.category,
      quantity: Number(record.quantity), unit_price_usd: Number(record.unit_price_usd),
      unit_cost_usd: record.unit_cost_usd ? Number(record.unit_cost_usd) : null,
    };
    if (!result.order_id || !result.product_name || !result.category || !Number.isFinite(Date.parse(result.sold_at)) || !Number.isInteger(result.quantity) || result.quantity < 1 || !Number.isFinite(result.unit_price_usd) || result.unit_price_usd < 0 || (result.unit_cost_usd !== null && (!Number.isFinite(result.unit_cost_usd) || result.unit_cost_usd < 0))) throw new Error(`Invalid or missing data on CSV line ${index + 2}.`);
    return result;
  });
}

function summarize(rows) {
  const sum = (arr, fn) => arr.reduce((total, item) => total + fn(item), 0);
  const revenue = sum(rows, (r) => r.quantity * r.unit_price_usd);
  const units = sum(rows, (r) => r.quantity);
  const orders = new Set(rows.map((r) => r.order_id)).size;
  const under = sum(rows.filter((r) => r.unit_price_usd < 50), (r) => r.quantity);
  const grouped = (key) => {
    const map = new Map();
    rows.forEach((r) => {
      const name = r[key] || "Uncategorized";
      const current = map.get(name) || { name, units: 0, revenue: 0 };
      current.units += r.quantity; current.revenue += r.quantity * r.unit_price_usd; map.set(name, current);
    });
    return [...map.values()].sort((a, b) => b.revenue - a.revenue);
  };
  const dates = rows.map((r) => new Date(r.sold_at)).sort((a, b) => a - b);
  const fullCosts = rows.every((r) => r.unit_cost_usd !== null);
  const profit = fullCosts ? sum(rows, (r) => r.quantity * (r.unit_price_usd - r.unit_cost_usd)) : null;
  return { revenue, units, orders, under, categories: grouped("category"), products: grouped("product_name").slice(0, 8), start: dates[0], end: dates.at(-1), profit, margin: profit === null || revenue === 0 ? null : profit / revenue * 100 };
}

function renderRankList(target, groups, totalRevenue) {
  target.replaceChildren();
  if (!groups.length) { target.textContent = "No products found."; return; }
  for (const item of groups.slice(0, 6)) {
    const row = document.createElement("div"); row.className = "rank-row";
    const name = document.createElement("span"); name.className = "rank-name"; name.textContent = item.name;
    const amount = document.createElement("span"); amount.className = "rank-value"; amount.textContent = `${money(item.revenue)} · ${item.units} units`;
    const track = document.createElement("div"); track.className = "rank-track";
    const bar = document.createElement("i"); bar.style.width = `${Math.min(100, totalRevenue ? item.revenue / totalRevenue * 100 : 0)}%`; track.append(bar);
    row.append(name, amount, track); target.append(row);
  }
}

function renderSnapshot() {
  const s = summarize(salesRows);
  $("#insights").hidden = false;
  $("#session-title").textContent = [...new Set(salesRows.map((r) => r.event_name))].join(" · ");
  $("#date-range").textContent = `${s.start.toLocaleDateString()} — ${s.end.toLocaleDateString()}`;
  $("#revenue").textContent = money(s.revenue);
  $("#orders").textContent = `${s.orders} orders · ${salesRows.length} product lines`;
  $("#units").textContent = String(s.units);
  $("#aov").textContent = `Average order ${money(s.orders ? s.revenue / s.orders : 0)}`;
  $("#under50").textContent = String(s.under);
  $("#under50-share").textContent = `${s.units ? (s.under / s.units * 100).toFixed(1) : 0}% of units priced under $50`;
  $("#profit").textContent = s.profit === null ? "Not available" : money(s.profit);
  $("#margin").textContent = s.margin === null ? "Add unit costs to see margin" : `${s.margin.toFixed(1)}% gross margin`;
  renderRankList($("#categories"), s.categories, s.revenue);
  renderRankList($("#products"), s.products, s.revenue);
  $("#data-note").textContent = s.profit === null ? "Revenue is calculated as quantity × unit price. Profit is hidden because unit costs are missing; discounts and payment status are not independently verified." : "Revenue is calculated as quantity × unit price. Gross profit uses the unit costs in your CSV; payment status is not independently verified.";
  $("#question").disabled = false; $("#send").disabled = false;
}

function appendMessage(role, text, className = "") {
  const wrap = document.createElement("div"); wrap.className = `chat-message ${role === "assistant" ? "assistant-message" : "user-message"}`;
  if (role === "assistant") { const mark = document.createElement("span"); mark.className = "assistant-mark"; mark.textContent = "S"; wrap.append(mark); }
  const bubble = document.createElement("div"); bubble.className = `bubble ${className}`; bubble.textContent = text; wrap.append(bubble); $("#chat-log").append(wrap); wrap.scrollIntoView({ block: "nearest", behavior: "smooth" }); return bubble;
}

async function sendQuestion(question) {
  if (!salesRows.length || !question.trim()) return;
  const clean = question.trim(); history.push({ role: "user", content: clean }); appendMessage("user", clean);
  const placeholder = appendMessage("assistant", "Checking the sales data and asking Snowflake…", "thinking");
  $("#send").disabled = true;
  try {
    const response = await fetch("/api/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: clean, rows: salesRows, history: history.slice(-8) }) });
    const result = await response.json(); if (!response.ok) throw new Error(result.error || "Could not get an answer.");
    placeholder.classList.remove("thinking"); placeholder.textContent = result.answer; history.push({ role: "assistant", content: result.answer });
  } catch (error) { placeholder.classList.add("error"); placeholder.classList.remove("thinking"); placeholder.textContent = error.message; history.pop(); }
  finally { $("#send").disabled = false; $("#question").focus(); }
}

$("#csv-file").addEventListener("change", async (event) => {
  const file = event.target.files?.[0]; if (!file) return;
  if (file.size > 1_000_000) { $("#file-status").textContent = "CSV is too large (max 1 MB)."; return; }
  try {
    salesRows = parseCsv(await file.text()); history = [];
    $("#file-status").textContent = `${file.name} · ${salesRows.length} sales lines loaded.`;
    $("#chat-log").replaceChildren();
    const welcome = document.createElement("div"); welcome.className = "welcome"; welcome.innerHTML = '<span class="assistant-mark">S</span><p>Data loaded. Ask about performance, product mix, or what to test next.</p>'; $("#chat-log").append(welcome);
    renderSnapshot();
  } catch (error) { salesRows = []; $("#file-status").textContent = error.message; $("#question").disabled = true; $("#send").disabled = true; }
});

$("#chat-form").addEventListener("submit", (event) => { event.preventDefault(); const field = $("#question"); const q = field.value; field.value = ""; void sendQuestion(q); });
$("#question").addEventListener("keydown", (event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); $("#chat-form").requestSubmit(); } });
document.querySelectorAll("[data-prompt]").forEach((button) => button.addEventListener("click", () => { if (!salesRows.length) { $("#file-status").textContent = "Upload your sales CSV first."; return; } void sendQuestion(button.dataset.prompt); }));

fetch("/api/status").then((r) => r.json()).then((status) => {
  const badge = $("#connection");
  if (status.configured) { badge.dataset.state = "ok"; badge.innerHTML = `<b></b> Cortex ready · ${status.model}`; }
  else { badge.dataset.state = "bad"; badge.innerHTML = "<b></b> Snowflake not configured"; }
}).catch(() => { $("#connection").dataset.state = "bad"; $("#connection").textContent = "Backend not running"; });
