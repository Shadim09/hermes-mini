#!/usr/bin/env bash
# Shows what Telegram thinks about your webhook (last error, pending updates, ...).
# Very useful when "the bot is silent".   export BOT_TOKEN=... ; bash scripts/webhook-info.sh
set -euo pipefail
: "${BOT_TOKEN:?set BOT_TOKEN}"
BASE="${BOT_API_BASE:-https://api.telegram.org}"
curl -sS "${BASE}/bot${BOT_TOKEN}/getWebhookInfo"
echo
