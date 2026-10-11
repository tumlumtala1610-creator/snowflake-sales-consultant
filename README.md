# Snowflake Sales Consultant

A small standalone app for importing a real sales CSV, calculating verifiable business metrics, and asking Snowflake Cortex for Vietnamese consultant-style analysis through Snowflake's OpenAI-compatible JavaScript SDK endpoint.

## What it does

- Imports order-line CSV data and calculates revenue, units, average order value, price bands, category mix, top products, and gross margin when unit cost is provided.
- Calculates metrics from uploaded order lines on the server, then sends only the computed aggregate summary and chat context to Snowflake Cortex through a server-side proxy. The Snowflake token never goes to browser code.
- Instructs the model to cite the supplied numbers, separate evidence from hypotheses, and avoid inventing current fashion trends.
- Can be used standalone now; the CSV importer can later be replaced by a direct feed from Bazaarly.

## Requirements

- Node.js 20 or later.
- A Snowflake account that can use Cortex REST API, a Programmatic Access Token (PAT), and a role with `SNOWFLAKE.CORTEX_USER` or `SNOWFLAKE.CORTEX_REST_API_USER`.

## Run locally

```bash
npm install
cp .env.example .env
```

Edit `.env` with your Snowflake account URL and PAT. Then:

```bash
npm run dev
```

Open http://localhost:3000.

Without Snowflake credentials, the CSV import and sales calculations work, but the AI chat stays disabled. No sample sales are shown as if they were yours.

## CSV format

Required columns: `order_id`, `sold_at`, `product_name`, `category`, `quantity`, `unit_price_usd`.

Optional columns: `event_name`, `unit_cost_usd`. One row represents one product line in an order. Repeat `order_id` for multiple products in the same order. `unit_cost_usd` enables gross-profit and margin calculations; without it, the app will not claim to know profit.

Use USD values (for example `19.99`) and an ISO date such as `2026-10-10`. The included `sales-template.csv` is an empty header template.

## What the AI can and cannot infer

It can discuss only the imported sales data and the computed metrics. It can recommend what to test or research next. It does not have live web search or a live fashion-trends feed, so it must not claim a design is trending right now. Connect a dated market-research feed in a later version to support those claims.

## Snowflake API setup

The server uses the OpenAI JavaScript SDK with Snowflake's Cortex base URL (`https://<account-identifier>.snowflakecomputing.com/api/v2/cortex/v1`), then calls `client.chat.completions.create(...)`. This sends the request to Snowflake's `POST /api/v2/cortex/v1/chat/completions` endpoint. Snowflake credentials stay in `.env`; do not commit that file or paste the PAT into the browser. Select a model enabled for your account with `SNOWFLAKE_MODEL`.

## Later integration into Bazaarly

Replace the CSV upload with a backend endpoint that reads confirmed order items from Bazaarly's database and builds the same row format. Keep the Cortex call on a server route and keep the PAT in server-only environment variables.
