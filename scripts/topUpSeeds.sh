#!/usr/bin/env bash
# Tops up the sandbox seed pool. RUN BY A PERSON. Sequential on purpose (one buyer login at a time).
#   SANDBOX_BUYER_EMAIL=... SANDBOX_BUYER_PASSWORD=... bash scripts/topUpSeeds.sh <how many> [batch size]
# Creates the seeds in batches (default 5): create -> approve one after another -> collect.
# Measured: 32 to 50 seconds per seed, so 60 seeds take about 40 minutes. Output goes to a log file only.
set -euo pipefail
cd "$(dirname "$0")/.."
TARGET="${1:?usage: bash scripts/topUpSeeds.sh <how many> [batch size]}"
BATCH="${2:-5}"
: "${SANDBOX_BUYER_EMAIL:?set SANDBOX_BUYER_EMAIL}"
: "${SANDBOX_BUYER_PASSWORD:?set SANDBOX_BUYER_PASSWORD}"
mkdir -p .scratch
LOG=".scratch/topup-$(date +%Y%m%d-%H%M%S).log"
echo "log: $LOG"
DONE=0
while [ "$DONE" -lt "$TARGET" ]; do
  N=$(( TARGET - DONE < BATCH ? TARGET - DONE : BATCH ))
  {
    echo "== batch of $N (done $DONE of $TARGET)"
    node scripts/seedLive.js create "$N"
    python3 scripts/approveSeeds.py
    node scripts/seedLive.js collect
  } >>"$LOG" 2>&1
  DONE=$(( DONE + N ))
  echo "done $DONE of $TARGET"
done
node scripts/seedLive.js collect >>"$LOG" 2>&1
tail -n 1 "$LOG"
