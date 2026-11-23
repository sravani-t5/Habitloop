#!/usr/bin/env bash
# End-to-end smoke test of the whole HabitLoop flow. Usage: BASE=http://localhost:8080 ./scripts/e2e.sh
set -uo pipefail
BASE=${BASE:-http://localhost:8080}
U=${USER_URL:-$BASE/api/users}; A=${ACTIVITY_URL:-$BASE/api/activities}; C=${CHALLENGE_URL:-$BASE/api/challenges}
I=${INTEGRATION_URL:-$BASE/api/integrations}; AN=${ANALYTICS_URL:-$BASE/api/analytics}; R=${RECO_URL:-$BASE/api/recommendations}
RUN=$RANDOM; PASS=0; FAIL=0
j(){ curl -s -H 'content-type: application/json' "$@"; }
auth(){ local t=$1; shift; j -H "authorization: Bearer $t" "$@"; }
check(){ if [ "$2" = "$3" ]; then echo "  ✔ $1"; PASS=$((PASS+1)); else echo "  ✘ $1 (expected '$3', got '$2')"; FAIL=$((FAIL+1)); fi; }

echo "1. Sign up (two tenants)"
AL=$(j -X POST $U/auth/signup -d "{\"email\":\"alice$RUN@a.com\",\"password\":\"password1\",\"name\":\"Alice\",\"tenantName\":\"Acme $RUN\"}")
AT=$(echo $AL | jq -r .token); ATENANT=$(echo $AL | jq -r .user.tenantId)
BO=$(j -X POST $U/auth/signup -d "{\"email\":\"bob$RUN@b.com\",\"password\":\"password1\",\"name\":\"Bob\",\"tenantName\":\"Beta $RUN\"}"); BT=$(echo $BO | jq -r .token)
CA=$(j -X POST $U/auth/signup -d "{\"email\":\"carol$RUN@a.com\",\"password\":\"password1\",\"name\":\"Carol\",\"tenantId\":\"$ATENANT\"}"); CT=$(echo $CA | jq -r .token)
check "alice token issued" "$([ -n "$AT" ] && [ "$AT" != null ] && echo yes)" yes
check "login works" "$(j -X POST $U/auth/login -d "{\"email\":\"alice$RUN@a.com\",\"password\":\"password1\"}" | jq -r '.user.name')" Alice
check "wrong password rejected" "$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'content-type: application/json' $U/auth/login -d "{\"email\":\"alice$RUN@a.com\",\"password\":\"nope-nope\"}")" 401

echo "2. Create habits"
RUNID=$(auth $AT -X POST $A -d '{"name":"Morning Run","scheduledTime":"06:00","frequencyPerWeek":4}' | jq -r .id)
STEPS=$(auth $AT -X POST $A -d '{"name":"Daily Steps","scheduledTime":"20:00"}' | jq -r .id)
check "habit created" "$([ -n "$RUNID" ] && [ "$RUNID" != null ] && echo yes)" yes

echo "3. Log history: misses at 06:00, completions at 18:00"
for d in 10 11 12 13; do auth $AT -X POST $A/$RUNID/logs -d "{\"status\":\"missed\",\"loggedAt\":\"2026-11-${d}T06:10:00+05:30\"}" >/dev/null; done
for d in 14 15 16 17; do auth $AT -X POST $A/$RUNID/logs -d "{\"status\":\"completed\",\"loggedAt\":\"2026-11-${d}T18:05:00+05:30\"}" >/dev/null; done
sleep 1.5
S=$(auth $AT $AN/summary)
check "analytics totals (4 done, 4 missed)" "$(echo $S | jq -r '"\(.totalDone)/\(.totalMissed)"')" "4/4"
check "longest streak = 4 days" "$(echo $S | jq -r .longestStreak)" 4

echo "4. Recommendations"
RECS=$(auth $AT -X POST $R/generate)
check "timing recommendation produced" "$(echo $RECS | jq -r '.[0].type')" timing
check "suggests 18:00" "$(echo $RECS | jq -r '.[0].suggestedValue')" "18:00"
RID=$(echo $RECS | jq -r '.[0].id')
auth $AT -X POST $R/$RID/accept >/dev/null
check "accept updated the habit schedule" "$(auth $AT $A/$RUNID | jq -r .scheduledTime)" "18:00"

echo "5. Challenges"
PUB=$(auth $AT -X POST $C -d '{"title":"Nov Fitness","visibility":"public","goalTarget":10,"startDate":"2026-11-01","endDate":"2026-11-30"}' | jq -r .id)
PRIV=$(auth $AT -X POST $C -d '{"title":"Secret Squad","visibility":"private","goalTarget":5,"startDate":"2026-11-01","endDate":"2026-11-30"}' | jq -r .id)
check "carol (same tenant) joins public" "$(auth $CT -X POST $C/$PUB/join | jq -r .joined)" true
check "carol cannot join private w/o invite" "$(curl -s -o /dev/null -w '%{http_code}' -X POST -H "authorization: Bearer $CT" $C/$PRIV/join)" 404
auth $AT -X POST $C/$PRIV/invites -d "{\"email\":\"carol$RUN@a.com\"}" >/dev/null
INV=$(auth $CT $C/invites | jq -r '.[0].id')
check "carol accepts invite" "$(auth $CT -X POST $C/invites/$INV/accept | jq -r .accepted)" true
check "leaderboard: alice has 4 done" "$(auth $AT $C/$PUB/leaderboard | jq -r '.leaderboard[] | select(.name=="Alice") | .done')" 4

echo "6. Wearable integration (RDS -> EventBridge -> Lambda -> activity log -> analytics)"
DEV=$(auth $AT -X POST $I -d '{"provider":"FitBand","deviceLabel":"Alice wrist"}'); TOK=$(echo $DEV | jq -r .deviceToken)
NOW=$(date -u +%Y-%m-%dT%H:%M:%S+00:00)
EV="{\"eventId\":\"ev-$RUN\",\"type\":\"steps\",\"value\":8200,\"unit\":\"steps\",\"timestamp\":\"$NOW\"}"
E1=$(j -X POST $I/events -H "x-device-token: $TOK" -d "$EV")
check "event accepted (202 RECEIVED)" "$(echo $E1 | jq -r .status)" RECEIVED
sleep 1.5
check "event processed by Lambda" "$(auth $AT $I/events/recent | jq -r '.[0].status')" PROCESSED
check "log appeared on 'Daily Steps' habit" "$(auth $AT $A/$STEPS/logs | jq -r '.[0].source')" wearable
E2=$(j -X POST $I/events -H "x-device-token: $TOK" -d "$EV")
check "replayed event is idempotent" "$(echo $E2 | jq -r .duplicate)" true
check "invalid device token rejected" "$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'content-type: application/json' -H 'x-device-token: bad' $I/events -d "$EV")" 401
BAD=$(j -X POST $I/events -H "x-device-token: $TOK" -d "{\"eventId\":\"old-$RUN\",\"type\":\"steps\",\"value\":9000,\"timestamp\":\"2020-01-01T00:00:00+00:00\"}")
sleep 1.5
check "stale event REJECTED by Lambda" "$(auth $AT $I/events/recent | jq -r '.[0].status')" REJECTED

echo "7. Tenant isolation (Bob is in another tenant)"
check "bob cannot read alice's habit" "$(curl -s -o /dev/null -w '%{http_code}' -H "authorization: Bearer $BT" $A/$RUNID)" 404
check "bob cannot see alice's challenges" "$(auth $BT $C | jq 'length')" 0
check "bob cannot open alice's challenge" "$(curl -s -o /dev/null -w '%{http_code}' -H "authorization: Bearer $BT" $C/$PUB)" 404
check "bob's analytics are empty" "$(auth $BT $AN/summary | jq -r .totalDone)" 0
check "no token => 401" "$(curl -s -o /dev/null -w '%{http_code}' $A)" 401

echo; echo "Passed: $PASS  Failed: $FAIL"; [ $FAIL -eq 0 ]
