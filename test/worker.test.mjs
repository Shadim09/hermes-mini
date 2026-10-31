// Unit tests for the pure functions. Run:  npm test   (Node 20+; no dependencies)
import test from "node:test";
import assert from "node:assert/strict";
import { parseAction, tehranDate, tehranHour, toFa, formatTasks } from "../src/index.js";

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
