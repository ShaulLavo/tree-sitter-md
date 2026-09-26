#!/usr/bin/env bash
set -euo pipefail
: "${BASELINE:?}" "${HARNESS:?}" "${WASI_SDK:?}"
mkdir -p work/baseline work/candidate validation/baseline validation/candidate
git archive "$BASELINE" | tar -x -C work/baseline
cp -a work/baseline/. work/candidate/
git archive "$HARNESS" experiments/perf | tar -x
patch --batch --fuzz=0 -p1 -d work/candidate < experiments/perf-next/ascii-prefix.patch
cp experiments/perf-next/ascii-prefix.patch validation/candidate.patch
python3 - <<'PY'
from pathlib import Path
base=Path('work/baseline');candidate=Path('work/candidate')
slow=(base/'src/leaf.c').read_text()
slow=slow[slow.index('static void push_character'):slow.index('void leaf_single')].replace('push_character','slow_character').replace('push_lines','slow_lines')
test='#include "resolver.h"\n#include <assert.h>\n#include <stdio.h>\n// Scalar baseline is the independent mapping oracle.\n'+slow+Path('experiments/perf-next/leaf-map-main.c').read_text()
for d in [base,candidate]:(d/'tests/leaf-map.c').write_text(test)
PY
# Reuse the already exercised native-test driver, not its runtime implementation.
git show 032cae958efbb878aa756d571228be2dd045eba8:scripts/check-perf-native.sh > work/baseline/scripts/check-perf-native.sh
cp work/baseline/scripts/check-perf-native.sh work/candidate/scripts/
for item in 'platform fregat c130dd35a202dd06ccd160bd5ed0789c889315c2' 'editor singapore 74e76bef2af674ad80b3c13024fa47f692e2bb7c'; do
  read -r local_name repo sha <<< "$item"
  git init "$RUNNER_TEMP/$local_name"
  git -C "$RUNNER_TEMP/$local_name" fetch --depth=1 "https://github.com/ShaulLavo/$repo.git" "$sha"
  test "$(git -C "$RUNNER_TEMP/$local_name" rev-parse FETCH_HEAD)" = "$sha"
done
export PLATFORM="$RUNNER_TEMP/platform" EDITOR_REPO="$RUNNER_TEMP/editor"
echo '2c5c01ed08af3c921c8c500b6c9f50d9e48d39480bedc91355dc88377e9adbf1  work/baseline/bench/corpus/chat.json' | sha256sum -c -
npm --prefix work/baseline/bench install --ignore-scripts --no-audit --no-fund
cp -a work/baseline/bench/node_modules work/candidate/bench/
cp work/baseline/bench/package-lock.json validation/dependencies-package-lock.json
{ uname -a; lscpu; node --version; clang --version; "$WASI_SDK/bin/clang" --version; git rev-parse HEAD; } > validation/environment.txt
for build in baseline candidate; do
  (cd "work/$build" && sh scripts/build.sh) | tee "validation/$build/build.txt"
  cp "work/$build/tree-sitter-md.wasm" "validation/$build/tree-sitter-md.wasm"
  sha256sum "work/$build/tree-sitter-md.wasm" > "validation/$build/wasm-sha256.txt"
done
git show "$BASELINE:tree-sitter-md.wasm" | cmp - work/baseline/tree-sitter-md.wasm
for build in baseline candidate; do
  for command in 'npm test' 'sh scripts/check-native.sh' 'sh scripts/check-perf-native.sh' 'node bench/cursor-seek.mjs --check'; do
    name=$(printf '%s' "$command" | tr ' /' '--')
    if ! (cd "work/$build" && sh -c "$command") > "validation/$build/$name.txt" 2>&1; then
      cat "validation/$build/$name.txt"; exit 1
    fi
    printf '%s: %s passed\n' "$build" "$command"
  done
  if ! (cd "work/$build" && CHAT="$GITHUB_WORKSPACE/work/$build/bench/corpus/chat.json" node scripts/check-gates.mjs) > "validation/$build/full-gates.txt" 2>&1; then
    cat "validation/$build/full-gates.txt"; exit 1
  fi
  cat "validation/$build/full-gates.txt"
  cp -a "work/$build/bench/out" "validation/$build/out"
  node experiments/perf/public-checks.mjs "work/$build" "validation/$build" > "validation/$build/public-checks.txt"
done
node --input-type=module <<'JS'
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>JSON.parse(readFileSync(p));
assert.deepEqual(read('validation/baseline/spec-results.json'),read('validation/candidate/spec-results.json'));
assert.deepEqual(read('validation/baseline/out/corpus-stats.json'),read('validation/candidate/out/corpus-stats.json'));
console.log('Exact specification and corpus parity passed');
JS
node experiments/perf-next/stress.mjs work/baseline work/candidate > validation/additional-stress.json
node --input-type=module <<'JS'
import {readFileSync} from 'node:fs';
const x=JSON.parse(readFileSync('validation/additional-stress.json'));
console.log(JSON.stringify({edits:x.edits,comparisons:x.comparisons,newRegressions:x.newRegressions,baselineFreshDivergences:x.baselineFreshDivergences}));
JS
for round in 1 2 3 4 5 6; do
  order='baseline candidate'; if [ $((round % 2)) -eq 0 ]; then order='candidate baseline'; fi
  for build in $order; do
    BUILD_LABEL="$build" ROUND="$round" node experiments/perf/keystroke-isolated.mjs "work/$build" > "validation/$build/standard-$round.jsonl"
    BUILD_LABEL="$build" ROUND="$round" node experiments/perf-next/bench-targets.mjs "work/$build" > "validation/$build/targets-$round.jsonl"
    BUILD_LABEL="$build" ROUND="$round" node experiments/perf-next/warm-keystroke.mjs "work/$build" > "validation/$build/warm-$round.jsonl"
    BUILD_LABEL="$build" ROUND="$round" node experiments/perf-next/bench-encodings.mjs "work/$build" > "validation/$build/encodings-$round.jsonl"
  done
  printf 'Paired benchmark round %s passed final fresh-parse checks\n' "$round"
done
for build in baseline candidate; do
  (cd "work/$build" && node bench/memory.mjs) > "validation/$build/memory.jsonl"
done
printf 'Completed all original and added checks; performance data still requires review.\n' > validation/PASS.txt
