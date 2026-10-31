#!/usr/bin/env bash
# Registers the Worker URL as the bot's webhook, with the secret token.
# Secrets come from your shell environment — nothing is stored in this file.
#
#   export BOT_TOKEN='123456:ABC...'
#   export WEBHOOK_SECRET='the-same-value-you-gave-to-wrangler-secret-put'
#   export WORKER_URL='https://hermes-mini.<your-subdomain>.workers.dev'
#   bash scripts/set-webhook.sh
#
# Optional: BOT_API_BASE (default https://api.telegram.org) — e.g. for Bale.
set -euo pipefail

: "${BOT_TOKEN:?set BOT_TOKEN}"
: "${WEBHOOK_SECRET:?set WEBHOOK_SECRET}"
: "${WORKER_URL:?set WORKER_URL}"
BASE="${BOT_API_BASE:-https://api.telegram.org}"

curl -sS "${BASE}/bot${BOT_TOKEN}/setWebhook" \
  --data-urlencode "url=${WORKER_URL%/}/webhook" \
  --data-urlencode "secret_token=${WEBHOOK_SECRET}" \
  --data-urlencode 'allowed_updates=["message"]' \
  --data-urlencode "drop_pending_updates=true"
echo
