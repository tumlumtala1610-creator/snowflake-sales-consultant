import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { createReadStream } from "node:fs";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import OpenAI from "openai";
import { analyze, normalizeSales } from "./analytics.js";

const root = fileURLToPath(new URL(".", import.meta.url));
loadEnv();

function loadEnv() {
  const envPath = join(root, ".env");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m || m[1] in process.env) continue;
    process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, "$2");
  }
}

const port = Number(process.env.PORT || 3000);
const token = process.env.SNOWFLAKE_PAT?.trim() || "";
const accountUrl = (process.env.SNOWFLAKE_ACCOUNT_URL || "").trim().replace(/\/$/, "");
const model = (process.env.SNOWFLAKE_MODEL || "llama3.1-70b").trim();
const cortex = token && accountUrl && !accountUrl.includes("YOUR_ACCOUNT")
  ? new OpenAI({ apiKey: token, baseURL: `${new URL(accountUrl).origin}/api/v2/cortex/v1` })
  : null;

function sendJson(res, status, data) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(data));
}

async function readBody(req) {
  const chunks = [];
  let length = 0;
  for await (const chunk of req) {
    length += chunk.length;
    if (length > 1_500_000) throw new Error("Request too large. Keep the uploaded sales file under 1.5 MB.");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

const systemPrompt = `You are a practical small-business sales consultant. Reply in Vietnamese unless the user asks otherwise. Use only the uploaded sales rows and computed metrics included in the conversation. Treat the metrics as authoritative calculations, but do not claim payment verification. For numeric claims, quote the relevant count, USD amount, or percentage and state the denominator (units, orders, revenue, or lines). Distinguish observed facts from interpretations and recommendations. Never invent missing costs, inventory, customer demographics, competitor data, or current fashion trends. This app has no live web search. If asked what is trending now, say the sales data cannot establish that; propose a specific market-research plan and what evidence to collect. Avoid generic advice. End with 1-3 concrete next actions that can be tested at the next sale. If the data is too small to support a broad conclusion, say so.`;

async function chat(req, res) {
  if (!cortex) return sendJson(res, 503, { error: "Snowflake chưa được cấu hình. Điền account URL và PAT trong file .env rồi khởi động lại." });
  let body;
  try { body = await readBody(req); } catch (e) { return sendJson(res, 400, { error: e.message }); }
  try {
    const rows = normalizeSales(body.rows);
    const metrics = analyze(rows);
    const question = String(body.message || "").trim().slice(0, 3000);
    if (!question) return sendJson(res, 400, { error: "Nhập câu hỏi trước." });
    const history = Array.isArray(body.history) ? body.history.slice(-9, -1).map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: String(m.content || "").slice(0, 2000) })) : [];
    const response = await cortex.chat.completions.create({
      model,
      max_completion_tokens: 900,
      temperature: 0.2,
      messages: [
        { role: "system", content: systemPrompt },
        ...history,
        { role: "user", content: `COMPUTED SALES METRICS (JSON):\n${JSON.stringify(metrics)}\n\nQUESTION: ${question}` },
      ],
    });
    const answer = response.choices?.[0]?.message?.content;
    if (!answer) return sendJson(res, 502, { error: "Snowflake trả về phản hồi trống. Thử lại hoặc đổi model trong .env." });
    return sendJson(res, 200, { answer, metrics, model });
  } catch (error) {
    const status = error.status;
    if (status) {
      const message = status === 401 || status === 403
        ? "Snowflake từ chối xác thực/quyền Cortex. Kiểm tra PAT còn hạn và role được cấp Cortex REST API."
        : status === 429 ? "Snowflake đang giới hạn số request. Chờ một chút rồi thử lại."
          : `Snowflake Cortex trả lỗi HTTP ${status}. Kiểm tra model và cấu hình tài khoản.`;
      return sendJson(res, 502, { error: message });
    }
    const message = error.name === "APIConnectionTimeoutError" ? "Snowflake phản hồi quá lâu. Thử lại sau." : "Không kết nối được Snowflake. Kiểm tra account URL, mạng và PAT.";
    return sendJson(res, 502, { error: message });
  }
}

function contentType(path) {
  return ({ ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".csv": "text/csv; charset=utf-8" })[extname(path)] || "application/octet-stream";
}

createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  if (url.pathname === "/api/status") return sendJson(res, 200, { configured: Boolean(token && accountUrl && !accountUrl.includes("YOUR_ACCOUNT")), model });
  if (url.pathname === "/api/chat" && req.method === "POST") return chat(req, res);
  if (req.method !== "GET" && req.method !== "HEAD") return sendJson(res, 405, { error: "Method not allowed." });
  let filePath = normalize(join(root, "public", url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname.slice(1))));
  if (!filePath.startsWith(join(root, "public"))) return sendJson(res, 403, { error: "Forbidden." });
  if (!existsSync(filePath)) return sendJson(res, 404, { error: "Not found." });
  res.writeHead(200, { "content-type": contentType(filePath), "x-content-type-options": "nosniff" });
  if (req.method === "HEAD") return res.end();
  createReadStream(filePath).pipe(res);
}).listen(port, "127.0.0.1", () => console.log(`Sales consultant running at http://localhost:${port}`));
