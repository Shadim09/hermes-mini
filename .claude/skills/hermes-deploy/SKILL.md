---
name: hermes-deploy
description: Checklist for safely deploying hermes-mini to Cloudflare (tests, secret scan, D1 migrations, secrets, deploy, webhook, health check). Use when the user asks to deploy, redeploy, or verify the bot.
---

# hermes-deploy

Follow in order. Stop and report if any step fails; never skip the secret scan.

1. **Tests**: `npm test`, then (optional) `npm run mock &`, `npm run host &`, `npm run e2e`.
2. **Secret scan**: `bash scripts/check-secrets.sh` must print "no obvious secrets found".
   Also confirm `git status` shows no `.dev.vars`.
3. **Database**: make sure `database_id` in `wrangler.toml` is the real id
   (`npx wrangler d1 list`), then `npm run db:migrate:remote`.
   Schema changes = a NEW file `migrations/000N_*.sql`, never edit old ones.
4. **Deploy**: `npx wrangler deploy` and note the printed `*.workers.dev` URL.
5. **Secrets** (ask the user to run these; never ask them to paste values into chat):
   `npx wrangler secret put WEBHOOK_SECRET | BOT_TOKEN | ALLOWED_USER_ID`
   (and `LLM_API_KEY` only if `LLM_PROVIDER = "openai-compatible"`).
6. **Health**: `curl -sS <URL>/health` → `{"ok":true,...}` (use curl, not a browser: workers.dev is filtered in Iran).
7. **Webhook**: `bash scripts/set-webhook.sh`, then `bash scripts/webhook-info.sh`
   (`last_error_message` should be absent, `pending_update_count` ~ 0).
8. **Live check**: message the bot (with VPN), watch `npm run logs`.
9. If the bot is silent with no log lines at all → see `docs/PITFALLS.md` (Cloudflare Access / Zero Trust on workers.dev).
