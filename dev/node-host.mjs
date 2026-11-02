// A tiny Node host that runs src/index.js (the REAL worker code, unchanged) with a
// D1-compatible shim on top of node:sqlite. It lets you run the end-to-end test with
// nothing installed except Node 22+.
//
// IMPORTANT: this is a test harness, not a replacement for `wrangler dev` / the real
// Cloudflare runtime. Before the demo, always verify on the real deployment.
//
//   terminal 1:  node dev/mock-server.mjs
//   terminal 2:  node dev/node-host.mjs
//   terminal 3:  node dev/e2e.mjs

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import worker, { tehranHour } from "../src/index.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.PORT || 8787);

// ── D1 shim (only the methods the worker uses) ──
const sqlite = new DatabaseSync(":memory:");
for (const f of fs.readdirSync(path.join(root, "migrations")).filter((n) => n.endsWith(".sql")).sort()) {
  sqlite.exec(fs.readFileSync(path.join(root, "migrations", f), "utf8"));
}

class Stmt {
  constructor(sql, params = []) {
    this.sql = sql;
    this.params = params;
  }
  bind(...p) {
    return new Stmt(this.sql, p);
  }
  _run() {
    const st = sqlite.prepare(this.sql);
    if (/^\s*select/i.test(this.sql)) return { results: st.all(...this.params), success: true, meta: {} };
    const r = st.run(...this.params);
    return { results: [], success: true, meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
  }
  async run() {
    return this._run();
  }
  async all() {
    return this._run();
  }
  async first() {
    return this._run().results[0] ?? null;
  }
}
const DB = {
  prepare: (sql) => new Stmt(sql),
  async batch(stmts) {
    sqlite.exec("BEGIN");
    try {
      const out = stmts.map((s) => s._run());
      sqlite.exec("COMMIT");
      return out;
    } catch (e) {
      sqlite.exec("ROLLBACK");
      throw e;
    }
  },
};

const mock = process.env.MOCK_URL || "http://127.0.0.1:8790";
const baseEnv = {
  DB,
  WEBHOOK_SECRET: process.env.WEBHOOK_SECRET || "test-secret",
  BOT_TOKEN: "TEST:TOKEN",
  ALLOWED_USER_ID: process.env.ALLOWED_USER_ID || "111",
  LLM_PROVIDER: "openai-compatible",
  LLM_BASE_URL: `${mock}/v1`,
  LLM_API_KEY: "test",
  LLM_MODEL: "mock",
  BOT_API_BASE: mock,
  // Fake Workers AI: only used for speech-to-text here (the LLM is the mock server). The mock
  // "voice file" is just UTF-8 text, so decoding the base64 audio back to text plays Whisper.
  AI: {
    run: async (model, input) => {
      if (!/whisper/.test(model)) throw new Error(`unexpected AI model in test host: ${model}`);
      return { text: Buffer.from(input.audio, "base64").toString("utf8") };
    },
  },
};

http
  .createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = Buffer.concat(chunks);
    const pending = [];
    const ctx = { waitUntil: (p) => pending.push(p) };
    const url = `http://127.0.0.1:${PORT}${req.url}`;

    // test-only: trigger the cron handler as if it were exactly the reminder hour
    if (req.url.startsWith("/__cron")) {
      // /__cron            -> as if it were exactly the daily reminder hour right now
      // /__cron?at=<ISO>   -> as if the cron tick fired at that instant (default REMINDER_HOUR 8)
      const at = new URL(url).searchParams.get("at");
      if (at) {
        await worker.scheduled({ scheduledTime: Date.parse(at) }, { ...baseEnv, REMINDER_HOUR: "8" }, ctx);
      } else {
        await worker.scheduled({}, { ...baseEnv, REMINDER_HOUR: String(tehranHour()) }, ctx);
      }
      await Promise.all(pending);
      res.writeHead(200).end("cron done");
      return;
    }

    const request = new Request(url, {
      method: req.method,
      headers: req.headers,
      body: ["GET", "HEAD"].includes(req.method) ? undefined : body,
    });
    const response = await worker.fetch(request, baseEnv, ctx);
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
    Promise.allSettled(pending); // background work (like ctx.waitUntil) keeps running
  })
  .listen(PORT, "127.0.0.1", () => console.log(`node host for the worker on http://127.0.0.1:${PORT}`));
