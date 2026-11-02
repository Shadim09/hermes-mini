// Unit tests for the pure functions. Run:  npm test   (Node 20+; no dependencies)
import test from "node:test";
import assert from "node:assert/strict";
import {
  parseAction, callLLM, tehranDate, tehranHour, toFa, formatTasks,
  isRealDay, addDays, faDay, fmtDue, calendarTable, transcribe, toBase64,
} from "../src/index.js";

test("callLLM (workers-ai): disables thinking for gemma-4 and returns the text", async () => {
  let seen;
  const env = {
    LLM_PROVIDER: "workers-ai",
    LLM_MODEL: "@cf/google/gemma-4-26b-a4b-it",
    AI: {
      run: async (model, input) => {
        seen = { model, input };
        return { choices: [{ message: { content: '{"action":"list"}' } }] };
      },
    },
  };
  const out = await callLLM(env, [{ role: "user", content: "x" }]);
  assert.equal(out, '{"action":"list"}');
  assert.deepEqual(seen.input.chat_template_kwargs, { enable_thinking: false });
});

test("callLLM (workers-ai): null content becomes an empty string (retryable), not an exception", async () => {
  const env = {
    LLM_PROVIDER: "workers-ai",
    LLM_MODEL: "@cf/google/gemma-4-26b-a4b-it",
    AI: { run: async () => ({ choices: [{ message: { content: null }, finish_reason: "length" }] }) },
  };
  assert.equal(await callLLM(env, []), "");
  assert.equal(parseAction("").ok, false);
});

test("callLLM (workers-ai): other models do not get the gemma-only flag", async () => {
  let seen;
  const env = {
    LLM_PROVIDER: "workers-ai",
    LLM_MODEL: "@cf/some/other-model",
    AI: { run: async (_m, input) => ((seen = input), { response: "{}" }) },
  };
  await callLLM(env, []);
  assert.equal("chat_template_kwargs" in seen, false);
});

test("parseAction: valid actions", () => {
  assert.deepEqual(parseAction('{"action":"add","items":["شیر"]}').action, { action: "add", items: ["شیر"] });
  assert.deepEqual(parseAction('{"action":"add","text":"نان"}').action, { action: "add", items: ["نان"] });
  assert.deepEqual(parseAction('{"action":"done","target":3}').action, { action: "done", target: [3] });
  assert.deepEqual(parseAction('{"action":"del","target":"all"}').action, { action: "del", target: "all" });
  assert.deepEqual(parseAction('{"action":"undone","target":[3,1,3]}').action, { action: "undone", target: [1, 3] });
  assert.deepEqual(parseAction('{"action":"del","target":"2"}').action, { action: "del", target: [2] });
  assert.deepEqual(parseAction('{"action":"list"}').action, { action: "list" });
  assert.equal(parseAction('{"action":"chat","reply":"سلام"}').action.reply, "سلام");
});

test("parseAction: tolerates code fences and extra text around the JSON", () => {
  const r = parseAction('Sure!\n```json\n{"action":"list"}\n```');
  assert.equal(r.ok, true);
  assert.equal(r.action.action, "list");
});

test("parseAction: accepts an already-parsed object", () => {
  assert.equal(parseAction({ action: "list" }).ok, true);
});

test("parseAction: rejects malformed or dangerous output", () => {
  const bad = [
    "",
    "no json here",
    "{not json}",
    "[]",
    "null",
    '{"action":"drop_table"}',
    '{"action":"add"}',
    '{"action":"add","items":[]}',
    '{"action":"add","items":[""]}',
    '{"action":"add","items":[1]}',
    `{"action":"add","items":["${"x".repeat(201)}"]}`,
    '{"action":"done"}',
    '{"action":"done","target":0}',
    '{"action":"done","target":-1}',
    '{"action":"done","target":1.5}',
    '{"action":"del","target":[]}',
    '{"action":"del","target":"everything"}',
    '{"action":"chat"}',
    '{"action":"chat","reply":"   "}',
  ];
  for (const b of bad) assert.equal(parseAction(b).ok, false, `should reject: ${b}`);
});

test("parseAction: caps the number of added items", () => {
  const many = JSON.stringify({ action: "add", items: Array.from({ length: 11 }, (_, i) => `t${i}`) });
  assert.equal(parseAction(many).ok, false);
});

test("tehranDate follows Tehran time, not UTC", () => {
  // 20:45 UTC on Oct 30 is 00:15 on Oct 31 in Tehran (UTC+3:30)
  assert.equal(tehranDate(new Date("2026-10-30T20:45:00Z")), "2026-10-31");
  // 20:15 UTC is 23:45 the same day in Tehran
  assert.equal(tehranDate(new Date("2026-10-30T20:15:00Z")), "2026-10-30");
});

test("tehranHour: the 04:30 UTC cron tick is 08:00 in Tehran", () => {
  assert.equal(tehranHour(new Date("2026-10-31T04:30:00Z")), 8);
  assert.equal(tehranHour(new Date("2026-10-31T20:30:00Z")), 0);
});

test("toFa converts digits", () => {
  assert.equal(toFa(1402), "۱۴۰۲");
});

test("formatTasks", () => {
  assert.match(formatTasks([]), /خالیه/);
  const out = formatTasks([
    { id: 1, text: "شیر", done: 0 },
    { id: 2, text: "نان", done: 1 },
  ]);
  assert.match(out, /۱\. ⬜ شیر/);
  assert.match(out, /۲\. ✅ نان/);
});

// ── undo / due dates ──

test("parseAction: undo takes no arguments", () => {
  assert.deepEqual(parseAction('{"action":"undo"}').action, { action: "undo" });
});

test("parseAction: add with a due date and hour", () => {
  const r = parseAction('{"action":"add","items":["زنگ"],"due":{"date":"2026-11-03","hour":9}}');
  assert.deepEqual(r.action, { action: "add", items: ["زنگ"], due: { day: "2026-11-03", hour: 9 } });
  const r2 = parseAction('{"action":"add","items":["زنگ"],"due":{"date":"2026-11-03","hour":null}}');
  assert.equal(r2.action.due.hour, null);
  assert.deepEqual(parseAction('{"action":"add","items":["a"],"due":null}').action, { action: "add", items: ["a"] });
});

test("parseAction: rejects impossible dates and hours", () => {
  const bad = [
    '{"action":"add","items":["a"],"due":{"date":"2026-02-30"}}',
    '{"action":"add","items":["a"],"due":{"date":"فردا"}}',
    '{"action":"add","items":["a"],"due":{"date":"2026-11-03","hour":24}}',
    '{"action":"add","items":["a"],"due":{"date":"2026-11-03","hour":9.5}}',
    '{"action":"add","items":["a"],"due":"2026-11-03"}',
    '{"action":"remind","target":1,"date":"nope"}',
    '{"action":"remind","target":"all","date":"2026-11-03"}',
    '{"action":"remind","target":0,"date":"2026-11-03"}',
  ];
  for (const b of bad) assert.equal(parseAction(b).ok, false, `should reject: ${b}`);
});

test("parseAction: remind sets or clears a reminder", () => {
  assert.deepEqual(parseAction('{"action":"remind","target":2,"date":"2026-11-05","hour":"8"}').action, {
    action: "remind", target: [2], due: { day: "2026-11-05", hour: 8 },
  });
  assert.deepEqual(parseAction('{"action":"remind","target":[1,2],"date":null}').action, {
    action: "remind", target: [1, 2], due: null,
  });
  assert.deepEqual(parseAction('{"action":"remind","target":"all","date":null}').action.due, null);
});

test("date helpers", () => {
  assert.equal(isRealDay("2026-11-02"), true);
  assert.equal(isRealDay("2026-13-01"), false);
  assert.equal(isRealDay("2026-2-1"), false);
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(addDays("2026-03-01", -1), "2026-02-28");
  assert.equal(faDay("2026-11-02"), "دوشنبه ۱۱ آبان");
  assert.equal(fmtDue("2026-11-03", 9), "سه‌شنبه ۱۲ آبان، ساعت ۰۹:۰۰");
  assert.equal(fmtDue("2026-11-03", null), "سه‌شنبه ۱۲ آبان");
  assert.equal(fmtDue("2026-11-03", null, 8), "سه‌شنبه ۱۲ آبان، ساعت ۰۸:۰۰");
});

test("calendarTable starts today and lists 30 consecutive days", () => {
  const lines = calendarTable("2026-11-02").split("\n");
  assert.equal(lines.length, 30);
  assert.match(lines[0], /^2026-11-02 = دوشنبه ۱۱ آبان \(today/);
  assert.match(lines[1], /^2026-11-03 = .*tomorrow/);
  assert.match(lines[29], /^2026-12-01 = /);
});

test("formatTasks shows the reminder of open tasks only", () => {
  const out = formatTasks([
    { id: 1, text: "الف", done: 0, due_day: "2026-11-03", due_hour: 9 },
    { id: 2, text: "ب", done: 1, due_day: "2026-11-03", due_hour: null },
  ]);
  assert.match(out, /الف {2}⏰ سه‌شنبه ۱۲ آبان، ساعت ۰۹:۰۰/);
  assert.equal((out.match(/⏰/g) || []).length, 1);
});

// ── voice ──

test("toBase64 round-trips binary data, including big buffers", () => {
  const big = new Uint8Array(100_000).map((_, i) => i % 256);
  assert.deepEqual(new Uint8Array(Buffer.from(toBase64(big), "base64")), big);
});

test("transcribe: sends base64 audio + Persian hint to Whisper and trims the text", async () => {
  let seen;
  const env = { AI: { run: async (model, input) => ((seen = { model, input }), { text: "  بخر   شیر \n" }) } };
  const out = await transcribe(env, new Uint8Array([1, 2, 3]));
  assert.equal(out, "بخر شیر");
  assert.equal(seen.model, "@cf/openai/whisper-large-v3-turbo");
  assert.equal(seen.input.language, "fa");
  assert.equal(seen.input.audio, "AQID");
});

test("transcribe: empty or missing text gives an empty string", async () => {
  assert.equal(await transcribe({ AI: { run: async () => ({}) } }, new Uint8Array([1])), "");
  assert.equal(await transcribe({ AI: { run: async () => ({ text: "   " }) } }, new Uint8Array([1])), "");
});
