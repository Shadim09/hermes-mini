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
r = await say("سلام");
check("chat reply", r.text?.includes("سلام"), r.text);

r = await say("حذف همه");
check("delete all", r.text?.includes("حذف شد"), r.text);
r = await say("چیه کارام؟");
check("list is empty afterwards", r.text?.includes("خالیه"), r.text);

// non text
const photoId = ++updateId;
const before = await sentCount();
await post({ update_id: photoId, message: { message_id: photoId, from: { id: OWNER }, chat: { id: OWNER, type: "private" }, photo: [{}] } });
await sleep(1500);
check("non-text message gets a polite answer", (await sentCount()) === before + 1 && (await lastSent()).text.includes("فقط پیام متنی"));

console.log(failed ? `\n${failed} check(s) FAILED` : "\nall checks passed");
process.exit(failed ? 1 : 0);
