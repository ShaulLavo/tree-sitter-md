#!/bin/bash
# Run in one wave-heavy slot. Baseline must be an independently built 4214f0c package.
set -euo pipefail
root=$(cd "$(dirname "$0")/.." && pwd)
baseline=${1:?usage: compare-builds.sh RUST_PACKAGE OUTPUT_DIRECTORY}
results=${2:?usage: compare-builds.sh RUST_PACKAGE OUTPUT_DIRECTORY}
mkdir -p "$results"
for round in 1 2 3; do
  order='rust c'
  if [ "$round" = 2 ]; then order='c rust'; fi
  for build in $order; do
    directory=$root
    if [ "$build" = rust ]; then directory=$baseline; fi
    (cd "$directory" && sh bench/run-all.sh)
    cp "$directory/bench/out/keystroke-runs.jsonl" "$results/$build-$round.jsonl"
    cp "$directory/bench/out/memory.jsonl" "$results/$build-memory-$round.jsonl"
    (cd "$directory/bench" && bun chromium.mjs) > "$results/$build-chromium-$round.txt"
  done
done
