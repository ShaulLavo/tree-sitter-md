#!/bin/sh
# The measurements in FINDINGS.md: three runs of each keystroke case, then memory.
set -eu
cd "$(dirname "$0")"
mkdir -p out
: > out/keystroke-runs.jsonl
for i in 1 2 3; do
  for f in docs/agents.md docs/big.md; do
    node keystroke.mjs "$f" >> out/keystroke-runs.jsonl
    IDLE_REPARSE=0 node keystroke.mjs "$f" | sed 's/^{/{"noIdleReparse":true,/' >> out/keystroke-runs.jsonl
  done
done
node memory.mjs > out/memory.jsonl
