#!/usr/bin/env bash
# Scans the project for things that look like leaked secrets. Run before every push:
#   bash scripts/check-secrets.sh
# Exit code 1 = something suspicious was found.
set -uo pipefail
cd "$(dirname "$0")/.."

found=0
EXCLUDES=(--exclude-dir=node_modules --exclude-dir=.git --exclude-dir=.wrangler --exclude=check-secrets.sh --exclude=package-lock.json)

scan() { # $1 = description, $2 = regex
  local out
  out=$(grep -rEn "${EXCLUDES[@]}" -- "$2" . 2>/dev/null || true)
  if [ -n "$out" ]; then
    echo "✗ $1:"; echo "$out" | sed 's/^/    /'; found=1
  fi
}

scan "Telegram/Bale bot token (digits:35 chars)" '[0-9]{8,10}:[A-Za-z0-9_-]{35}'
scan "OpenAI/OpenRouter style key"               'sk-(or-)?[A-Za-z0-9_-]{20,}'
scan "Bearer token literal"                      'Bearer [A-Za-z0-9._-]{30,}'
scan "Cloudflare API token variable with value"  'CLOUDFLARE_API_TOKEN *= *[A-Za-z0-9_-]{20,}'

if [ -f .dev.vars ] && command -v git >/dev/null 2>&1 && [ -d .git ]; then
  if git ls-files --error-unmatch .dev.vars >/dev/null 2>&1; then
    echo "✗ .dev.vars is tracked by git! run: git rm --cached .dev.vars"; found=1
  fi
fi

if [ "$found" -eq 0 ]; then echo "✓ no obvious secrets found"; else echo; echo "Fix the above BEFORE pushing. If a real token was ever pushed: revoke it (BotFather /revoke)."; fi
exit "$found"
