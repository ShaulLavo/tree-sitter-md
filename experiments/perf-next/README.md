Experiment: reference-dirty
Baseline: 9946e0699fd30d0b83024dd463503ce0ead92dbc
Validation run: https://github.com/ShaulLavo/tree-sitter-md/actions/runs/36271831300

This branch contains one isolated optimization, not the other candidates. Correctness validation is comparative against the fixed-cursor baseline. Existing specification failures and baseline incremental/fresh stress divergences remain explicitly recorded. Benchmark completion is not an automatic performance endorsement; the measured results must be reviewed before opening a PR.

Run npm test, scripts/check-native.sh, scripts/check-cursor.sh, scripts/check-perf-native.sh, and CHAT=bench/corpus/chat.json node scripts/check-gates.mjs with the pinned PLATFORM and EDITOR_REPO checkouts. The paired stress runner accepts baseline and candidate paths.
