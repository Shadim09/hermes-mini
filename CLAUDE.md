# hermes-mini — زمینهٔ پروژه برای هارنس هوش مصنوعی (Claude Code)

این فایل را Claude Code خودکار می‌خواند. قواعد ثابت پروژه:

## هدف
ربات تلگرام فارسی (متن آزاد) برای مدیریت کار روزانه، روی Cloudflare Workers + D1، فقط پلن رایگان.

## قواعد سخت (نقض = نمرهٔ صفر یا خطای طراحی)
1. **هیچ secret ای در ریپو.** توکن‌ها فقط با `wrangler secret put`. قبل از هر commit: `bash scripts/check-secrets.sh`.
2. کل منطق در **یک فایل** `src/index.js`. فریمورک سنگین اضافه نکن.
3. فقط Workers + D1 (+ Workers AI). هیچ سرور، کانتینر یا سرویس پولی.
4. تغییر دیتابیس فقط با **فایل migration جدید** در `migrations/` (فایل‌های قبلی را ویرایش نکن).
5. خروجی LLM قبل از هر نوشتن در DB با `parseAction()` اعتبارسنجی می‌شود؛ مسیر خطا هیچ چیز نمی‌نویسد.
6. پاسخ HTTP به webhook (بعد از تأیید secret) همیشه ۲۰۰ است، وگرنه تلگرام پیام را دوباره می‌فرستد.
7. «امروز» = روز تقویمی تهران (`tehranDate()`)، نه UTC.

## دستورها
- `npm test` — تست واحد
- `npm run mock` + `npm run host` + `npm run e2e` — تست سرتاسری محلی (بدون wrangler)
- `npx wrangler deploy` / `npm run logs` / `npm run db:migrate:remote`

## سبک
- پاسخ‌های ربات فارسی و کوتاه؛ کد و کامنت‌ها انگلیسی؛ مستندات فارسی.
- هر تغییر رفتار → تست در `test/` یا سناریو در `dev/e2e.mjs`.

## ابزارهای کمکی
- Skill پروژه: `.claude/skills/hermes-deploy` (چک‌لیست deploy).
- MCP: Cloudflare (جست‌وجوی مستندات و مدیریت منابع) — روش اتصال در `docs/AI_WORKFLOW.md`.
