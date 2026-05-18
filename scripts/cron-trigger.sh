#!/bin/sh
# Cron trigger script. Render's cron service runs this on schedule; it
# POSTs to the web service's /api/cron/rank route with the bearer token.
#
# Required env (set in Render dashboard or via render.yaml):
#   CRON_TARGET_URL  https://your-msr-service.onrender.com (no trailing slash)
#   CRON_TOKEN       same value as the web service's CRON_TOKEN
#
# Optional:
#   CRON_VERTICAL    defaults to "gaming"

set -e

VERTICAL="${CRON_VERTICAL:-gaming}"

if [ -z "$CRON_TARGET_URL" ] || [ -z "$CRON_TOKEN" ]; then
  echo "missing CRON_TARGET_URL or CRON_TOKEN" >&2
  exit 1
fi

# Render's `fromService.property: host` gives a bare hostname (no scheme).
# Allow either form.
case "$CRON_TARGET_URL" in
  http://*|https://*) ;;
  *) CRON_TARGET_URL="https://$CRON_TARGET_URL" ;;
esac

echo "→ POST $CRON_TARGET_URL/api/cron/rank?vertical=$VERTICAL"
curl -fsSL --max-time 90 \
  -X POST "$CRON_TARGET_URL/api/cron/rank?vertical=$VERTICAL" \
  -H "Authorization: Bearer $CRON_TOKEN"
echo
