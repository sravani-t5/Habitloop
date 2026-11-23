#!/usr/bin/env bash
# Creates a demo account with 14 days of history so the dashboard, analytics and Recommendations page have data.
# Usage: BASE=http://localhost:8080 ./scripts/seed-demo.sh      (login: demo@habitloop.dev / Demo1234!)
set -euo pipefail
BASE=${BASE:-http://localhost:8080}
EMAIL=demo@habitloop.dev; PASS='Demo1234!'
j(){ curl -sf -H 'content-type: application/json' "$@"; }

TOKEN=$(j -X POST $BASE/api/users/auth/signup -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\",\"name\":\"Demo User\",\"tenantName\":\"Demo Org\"}" 2>/dev/null | jq -r .token || true)
if [ -z "$TOKEN" ] || [ "$TOKEN" = null ]; then
  TOKEN=$(j -X POST $BASE/api/users/auth/login -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\"}" | jq -r .token)
fi
auth(){ j -H "authorization: Bearer $TOKEN" "$@"; }

if [ "$(auth $BASE/api/activities | jq length)" -gt 0 ]; then echo "Demo data already exists. Log in as $EMAIL / $PASS"; exit 0; fi

RUN=$(auth -X POST $BASE/api/activities -d '{"name":"Morning Run","scheduledTime":"06:00","frequencyPerWeek":5}' | jq -r .id)
auth -X POST $BASE/api/activities -d '{"name":"Daily Steps","scheduledTime":"20:00","frequencyPerWeek":7}' >/dev/null
auth -X POST $BASE/api/activities -d '{"name":"Evening Meditation","scheduledTime":"21:30","frequencyPerWeek":3}' >/dev/null

# Morning Run: planned at 06:00 but mostly missed; completed reliably around 18:00 -> timing recommendation
for d in 13 12 11 10 9 8 7; do
  day=$(date -d "$d days ago" +%Y-%m-%d)
  auth -X POST $BASE/api/activities/$RUN/logs -d "{\"status\":\"missed\",\"loggedAt\":\"${day}T06:15:00+05:30\"}" >/dev/null
done
for d in 6 5 4 3 2 1; do
  day=$(date -d "$d days ago" +%Y-%m-%d)
  auth -X POST $BASE/api/activities/$RUN/logs -d "{\"status\":\"completed\",\"loggedAt\":\"${day}T18:10:00+05:30\"}" >/dev/null
done
echo "Seeded. Log in as $EMAIL / $PASS, open Recommendations, click 'Analyse my habits'."
