// End-to-end check against a locally running worker (`wrangler dev`) + the mock server.
// See docs/GUIDE.md ("تست محلی") for how to start both. Exit code 0 = all passed.

const WORKER = process.env.WORKER_URL || "http://127.0.0.1:8787";
const MOCK = process.env.MOCK_URL || "http://127.0.0.1:8790";
const SECRET = process.env.WEBHOOK_SECRET || "test-secret";
const OWNER = Number(process.env.ALLOWED_USER_ID || 111);

let updateId = Math.floor(Date.now() / 1000);
let failed = 0;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sentCount = async () => (await (await fetch(`${MOCK}/__sent`)).json()).length;
const lastSent = async () => (await (await fetch(`${MOCK}/__sent`)).json()).at(-1);

function check(name, ok, extra = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  -> " + extra}`);
  if (!ok) failed++;
}

async function post(body, headers = { "X-Telegram-Bot-Api-Secret-Token": SECRET }) {
  return fetch(`${WORKER}/webhook`, {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": "hermes-e2e/1.0", ...headers },
    body: JSON.stringify(body),
  });
}

// sends a text message as `from` and waits (up to 8s) for the bot's reply
async function say(text, { from = OWNER, id = ++updateId, expectReply = true } = {}) {
  const before = await sentCount();
  const res = await post({ update_id: id, message: { message_id: id, from: { id: from }, chat: { id: from, type: "private" }, text } });
  if (res.status !== 200) return { status: res.status, text: null };
  if (!expectReply) {
    await sleep(1200);
    return { status: 200, text: (await sentCount()) > before ? (await lastSent()).text : null };
  }
  for (let i = 0; i < 40; i++) {
    if ((await sentCount()) > before) return { status: 200, text: (await lastSent()).text };
    await sleep(200);
  }
  return { status: 200, text: null };
}

await fetch(`${MOCK}/__reset`, { method: "POST" });

// health
const h = await fetch(`${WORKER}/health`);
const hj = await h.json();
check("GET /health is 200 and db is ok", h.status === 200 && hj.ok === true && hj.db === true, JSON.stringify(hj));
check("health shows a Tehran date", /^\d{4}-\d{2}-\d{2}$/.test(hj.tehran_today), JSON.stringify(hj));

// secret header (R6)
check("no secret -> 403", (await post({ update_id: 1 }, {})).status === 403);
check("wrong secret -> 403", (await post({ update_id: 1 }, { "X-Telegram-Bot-Api-Secret-Token": "nope" })).status === 403);

// whitelist (R5)
const intruder = await say("بخر شیر", { from: 999, expectReply: false });
check("unauthorized sender: HTTP 200 and NO reply", intruder.status === 200 && intruder.text === null, JSON.stringify(intruder));

// features (R1, R2)
let r = await say("بخر شیر");
check("add task", r.text?.includes("اضافه شد") && r.text.includes("شیر"), r.text);
r = await say("بخر نان");
check("add second task", r.text?.includes("اضافه شد"), r.text);
r = await say("چیه کارام؟");
check("list shows both tasks (Persian digits)", r.text?.includes("شیر") && r.text.includes("نان") && r.text.includes("۲"), r.text);
r = await say("شیر رو خریدم");
check("done by meaning", r.text?.includes("انجام شد") && r.text.includes("شیر"), r.text);
r = await say("شماره ۹ رو حذف کن");
check("out-of-range number gets a friendly message", r.text?.includes("توی لیست نیست"), r.text);
r = await say("چیه کارام؟");
check("nothing was deleted by the bad request", r.text?.includes("شیر") && r.text.includes("نان"), r.text);
r = await say("حذف شماره ۲");
check("delete by number", r.text?.includes("حذف شد") && r.text.includes("نان"), r.text);

// idempotency
const dupId = ++updateId;
await say("بخر تخم مرغ", { id: dupId });
const beforeDup = await sentCount();
const dup = await say("بخر تخم مرغ", { id: dupId, expectReply: false });
check("duplicate update_id is processed only once", dup.status === 200 && (await sentCount()) === beforeDup, `before=${beforeDup} after=${await sentCount()}`);

// bonus: daily reminder (only on hosts that expose /__cron, i.e. dev/node-host.mjs)
const cronProbe = await fetch(`${WORKER}/__cron`).catch(() => null);
if (cronProbe && cronProbe.status === 200) {
  // the probe above already fired the cron once; fire again and look at the new message
  const beforeCron = await sentCount();
  await fetch(`${WORKER}/__cron`);
  await sleep(500);
  const lastMsg = await lastSent();
  check("daily reminder lists the open tasks", (await sentCount()) > beforeCron && lastMsg.text.includes("صبح بخیر") && lastMsg.text.includes("تخم مرغ"), lastMsg?.text);
} else {
  console.log("SKIP  daily reminder (host has no /__cron; test it on the real deployment)");
}

// robustness (R3)
r = await say("خراب");
check("garbage LLM output -> safe fallback, no crash", r.text?.includes("متوجه منظورت نشدم"), r.text);
r = await say("نیمه");
check("first LLM output invalid, retry succeeds", r.text?.includes("بعد از تلاش دوم"), r.text);
r = await say("تهی");
check("empty LLM output is retried and recovers", r.text?.includes("بعد از خروجی خالی"), r.text);
r = await say("سلام");
check("chat reply", r.text?.includes("سلام"), r.text);

r = await say("حذف همه");
check("delete all", r.text?.includes("حذف شد"), r.text);
r = await say("چیه کارام؟");
check("list is empty afterwards", r.text?.includes("خالیه"), r.text);

// ── feature: undo ──
r = await say("بخر کتاب");
r = await say("برگردون");
check("undo reverts the last add", r.text?.includes("برگردونده شد") && r.text.includes("کتاب"), r.text);
r = await say("چیه کارام؟");
check("the undone task is gone from the list", !r.text?.includes("کتاب"), r.text);
await say("بخر چای");
await say("حذف همه");
r = await say("برگردون");
check("undo restores a deleted task", r.text?.includes("برگردونده شد"), r.text);
r = await say("چیه کارام؟");
check("restored task is back in the list", r.text?.includes("چای"), r.text);
await say("حذف همه");

// ── feature: due dates and reminders ──
const today = hj.tehran_today;
const addDaysStr = (d, n) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const tomorrow = addDaysStr(today, 1);
const dayAfter = addDaysStr(today, 2);

r = await say("بخر نان فردا ساعت ۹");
check("add with a due date and hour", r.text?.includes("اضافه شد") && r.text.includes("یادآور") && r.text.includes("۰۹:۰۰"), r.text);
r = await say("چیه کارام؟");
check("list shows the reminder", r.text?.includes("نان") && r.text.includes("⏰"), r.text);

// tomorrow 09:00 Tehran = 05:30 UTC
let c0 = await sentCount();
await fetch(`${WORKER}/__cron?at=${tomorrow}T05:30:00Z`);
await sleep(600);
check("the hourly cron sends the due reminder", (await sentCount()) === c0 + 1 && (await lastSent()).text.includes("یادآور") && (await lastSent()).text.includes("نان"), (await lastSent())?.text);
c0 = await sentCount();
await fetch(`${WORKER}/__cron?at=${tomorrow}T05:30:00Z`);
await sleep(600);
check("a reminder is sent only once", (await sentCount()) === c0, `before=${c0} after=${await sentCount()}`);

await say("بخر ماست پس‌فردا");
c0 = await sentCount();
await fetch(`${WORKER}/__cron?at=${dayAfter}T04:30:00Z`); // 08:00 Tehran = REMINDER_HOUR
await sleep(600);
const dueMsgs = (await (await fetch(`${MOCK}/__sent`)).json()).slice(c0).map((m) => m.text);
check("a day-only reminder fires at the morning hour", dueMsgs.some((t) => t.includes("یادآور") && t.includes("ماست")), JSON.stringify(dueMsgs));

r = await say("بخر کیک امروز ساعت ۰");
check("a reminder time in the past is refused but the task is kept", r.text?.includes("اضافه شد") && r.text.includes("⚠️") && r.text.includes("بدون یادآور"), r.text);
await say("حذف همه");

await say("بخر عسل");
r = await say("یادآور شماره ۱ فردا ساعت ۱۰");
check("set a reminder on an existing task", r.text?.includes("یادآور تنظیم شد") && r.text.includes("عسل"), r.text);
r = await say("یادآور شماره ۱ بردار");
check("remove a reminder", r.text?.includes("یادآور برداشته شد"), r.text);
r = await say("برگردون");
check("undo restores the removed reminder", r.text?.includes("برگردونده شد"), r.text);
r = await say("چیه کارام؟");
check("the restored reminder is shown again", r.text?.includes("عسل") && r.text.includes("⏰"), r.text);
await say("حذف همه");

// ── feature: voice notes ──
async function sayVoice(transcript, { duration = 4, from = OWNER, expectReply = true } = {}) {
  await fetch(`${MOCK}/__voice`, { method: "POST", body: JSON.stringify({ text: transcript }) });
  const before = await sentCount();
  const id = ++updateId;
  const res = await post({ update_id: id, message: { message_id: id, from: { id: from }, chat: { id: from, type: "private" }, voice: { file_id: "AwAD", duration, mime_type: "audio/ogg", file_size: 20000 } } });
  if (res.status !== 200) return { status: res.status, text: null };
  for (let i = 0; i < (expectReply ? 40 : 6); i++) {
    if ((await sentCount()) > before) return { status: 200, text: (await lastSent()).text };
    await sleep(200);
  }
  return { status: 200, text: null };
}
r = await sayVoice("بخر شیر");
check("a voice note is transcribed and acted on", r.text?.includes("🎙") && r.text.includes("بخر شیر") && r.text.includes("اضافه شد"), r.text);
r = await sayVoice("بخر شیر", { duration: 300 });
check("a too-long voice note is refused politely", r.text?.includes("کوتاه‌تر"), r.text);
r = await sayVoice("");
check("a silent voice note gets a friendly answer", r.text?.includes("نفهمیدم"), r.text);
r = await sayVoice("بخر شیر", { from: 999, expectReply: false });
check("voice note from a stranger: no reply", r.status === 200 && r.text === null, JSON.stringify(r));
await say("حذف همه");

// non text
const photoId = ++updateId;
const before = await sentCount();
await post({ update_id: photoId, message: { message_id: photoId, from: { id: OWNER }, chat: { id: OWNER, type: "private" }, photo: [{}] } });
await sleep(1500);
check("non-text message gets a polite answer", (await sentCount()) === before + 1 && (await lastSent()).text.includes("فقط پیام متنی"));

console.log(failed ? `\n${failed} check(s) FAILED` : "\nall checks passed");
process.exit(failed ? 1 : 0);
