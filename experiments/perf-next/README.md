Experiment: ascii-runs
Baseline: 680433b989ded6d633139614fd24514859200cc0
Validation: https://github.com/ShaulLavo/tree-sitter-md/actions/runs/36273326025

One isolated optimization. Correctness validation is comparative; existing baseline failures remain documented in the artifact. Benchmarks require review before opening a PR. This does not include or restore the deleted one-off cursor workflow.

Run npm test, sh scripts/check-native.sh, sh scripts/check-perf-native.sh, node bench/cursor-seek.mjs --check, and CHAT=bench/corpus/chat.json node scripts/check-gates.mjs with the pinned PLATFORM and EDITOR_REPO checkouts. The stress runner accepts baseline and candidate paths.
