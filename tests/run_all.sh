#!/usr/bin/env bash
# Runs every test. Usage:  CHROME=/path/to/chrome bash tests/run_all.sh
set -uo pipefail
cd "$(dirname "$0")/.."
export CHROME="${CHROME:-/usr/bin/chromium}"
python3 -m http.server 8124 >/dev/null 2>&1 &
SRV=$!
trap 'kill $SRV 2>/dev/null' EXIT
sleep 1
rc=0
node tests/unit_handTracker.mjs | tail -1 || rc=1
node tests/unit_gestures.mjs | tail -1 || rc=1
node tests/unit_sequence.mjs | tail -1 || rc=1
node tests/unit_sequenceHud.mjs | tail -1 || rc=1
node tests/unit_jutsuBridge.mjs | tail -1 || rc=1
node tests/unit_combatEngine.mjs | tail -1 || rc=1
node tests/unit_jutsuSystem.mjs | tail -1 || rc=1
node tests/unit_combatActionRouter.mjs | tail -1 || rc=1
node tests/unit_defenseSystem.mjs | tail -1 || rc=1
node tests/unit_multiplayer.mjs | tail -1 || rc=1
node tests/unit_ultimateEdition.mjs | tail -1 || rc=1
node tests/project_integrity.mjs | tail -1 || rc=1
for t in 2 3 4; do echo "browser_phase$t:"; python3 tests/browser_phase$t.py 2>&1 | grep -E "FAIL|checks passed" || rc=1; done
exit $rc
