// Local mock of BOTH external services, so the whole bot can be tested offline:
//   - a fake Telegram Bot API   (records every sendMessage)
//   - a fake OpenAI-compatible LLM (a tiny rule-based "brain" for Persian phrases)
//
// Run:  npm run mock          (listens on http://127.0.0.1:8790)
// It is a development tool only; it is never deployed.

import http from "node:http";

const PORT = Number(process.env.MOCK_PORT || 8790);
const sent = []; // messages the bot "sent to Telegram"
let voiceText = ""; // what the next downloaded "voice note" contains (the fake Whisper just decodes it)

const faDigits = (s) => s.replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)));

function parseTasks(system) {
  const tasks = [];
  for (const line of system.split("\n")) {
    const m = line.match(/^(\d+)\. \[( |x)\] (.*)$/);
    if (m) tasks.push({ n: Number(m[1]), done: m[2] === "x", text: m[3] });
  }
  return tasks;
}

function brain(messages) {
  const system = messages.find((m) => m.role === "system")?.content ?? "";
  const userMsg = messages.find((m) => m.role === "user")?.content ?? "";
  const text = faDigits((userMsg.match(/<<<\n([\s\S]*?)\n>>>/)?.[1] ?? "").trim());
  const tasks = parseTasks(system);
  const isRetry = messages.length > 2;
  const out = (o) => JSON.stringify(o);
  const today = system.match(/Today \(Asia\/Tehran\): (\d{4}-\d{2}-\d{2})/)?.[1];
  const calendar = [...system.matchAll(/^(\d{4}-\d{2}-\d{2}) = /gm)].map((m) => m[1]);
  const hourMatch = text.match(/ساعت (\d+)/);
  const hour = hourMatch ? Number(hourMatch[1]) : null;
  const dayFor = (t) => (t.includes("پس‌فردا") ? calendar[2] : t.includes("فردا") ? calendar[1] : t.includes("امروز") ? today : null);

  if (text.includes("خراب")) return "this is not json at all"; // always broken -> fallback path
  if (text.includes("تهی")) {
    // empty first answer (like a reasoning model that ran out of tokens), valid on retry
    return isRetry ? out({ action: "chat", reply: "بعد از خروجی خالی هم جواب دادم" }) : "";
  }
  if (text.includes("نیمه")) {
    return isRetry ? out({ action: "chat", reply: "بعد از تلاش دوم جواب دادم" }) : "```oops``` {not json";
  }
  if (text.includes("برگردون")) return out({ action: "undo" });
  if (text.includes("یادآور") && /شماره \d+/.test(text)) {
    const n = Number(text.match(/شماره (\d+)/)[1]);
    if (text.includes("بردار")) return out({ action: "remind", target: n, date: null });
    return out({ action: "remind", target: n, date: dayFor(text), hour });
  }
  if (text.includes("حذف")) {
    if (text.includes("همه")) return out({ action: "del", target: "all" });
    const n = text.match(/\d+/);
    if (n) return out({ action: "del", target: Number(n[0]) });
    if (text.includes("همین") && tasks.length) return out({ action: "del", target: tasks[tasks.length - 1].n });
    return out({ action: "chat", reply: "کدوم کار رو حذف کنم؟" });
  }
  if (text.includes("خریدم") || text.includes("انجام شد")) {
    const hit = tasks.find((t) => t.text.split(" ").some((w) => w.length > 2 && text.includes(w)));
    return hit
      ? out({ action: "done", target: hit.n })
      : out({ action: "chat", reply: "همچین کاری توی لیست پیدا نکردم." });
  }
  if (text.includes("چیه") || text.includes("لیست")) return out({ action: "list" });
  if (text.includes("بخر") || text.includes("اضافه")) {
    const day = dayFor(text);
    const item = text.replace(/(پس‌فردا|فردا|امروز)/g, "").replace(/ساعت \d+/g, "").replace(/\s+/g, " ").trim();
    return out(day ? { action: "add", items: [item], due: { date: day, hour } } : { action: "add", items: [text] });
  }
  if (text.includes("سلام")) return out({ action: "chat", reply: "سلام! چطور می‌تونم کمکت کنم؟" });
  return out({ action: "chat", reply: "نمی‌دونم چی بگم 🙂" });
}

const readBody = (req) =>
  new Promise((resolve) => {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => resolve(b));
  });

http
  .createServer(async (req, res) => {
    const send = (code, obj) => {
      res.writeHead(code, { "content-type": "application/json" });
      res.end(JSON.stringify(obj));
    };

    if (req.method === "POST" && req.url.endsWith("/chat/completions")) {
      const body = JSON.parse((await readBody(req)) || "{}");
      return send(200, { choices: [{ message: { role: "assistant", content: brain(body.messages || []) } }] });
    }
    if (req.method === "POST" && /\/bot[^/]*\/sendMessage$/.test(req.url)) {
      const body = JSON.parse((await readBody(req)) || "{}");
      sent.push({ chat_id: body.chat_id, text: body.text });
      return send(200, { ok: true });
    }
    if (req.method === "POST" && /\/bot[^/]*\/getFile$/.test(req.url)) {
      return send(200, { ok: true, result: { file_id: "x", file_path: "voice/note.oga" } });
    }
    if (req.method === "GET" && /^\/file\/bot[^/]*\/voice\/note\.oga$/.test(req.url)) {
      res.writeHead(200, { "content-type": "audio/ogg" });
      return res.end(Buffer.from(voiceText, "utf8"));
    }
    if (req.method === "POST" && req.url === "/__voice") {
      voiceText = JSON.parse((await readBody(req)) || "{}").text ?? "";
      return send(200, { ok: true });
    }
    if (req.method === "GET" && req.url === "/__sent") return send(200, sent);
    if (req.method === "POST" && req.url === "/__reset") {
      sent.length = 0;
      return send(200, { ok: true });
    }
    send(404, { ok: false });
  })
  .listen(PORT, "127.0.0.1", () => console.log(`mock Telegram + LLM on http://127.0.0.1:${PORT}`));
