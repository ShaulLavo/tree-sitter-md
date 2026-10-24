# Release 0.1 — 2026-09-28

Validated after the reference/setext, incremental definition extent, EOF fence and continuation
quote record fixes. CommonMark mode disables frontmatter; file hosts can opt in.

- 676/676 CommonMark and GFM examples; section floors enforced.
- 240 focused JavaScript tests, including 7,680 edit/undo comparisons across all four outputs,
  frontmatter edits, reference-boundary fixtures, nesting through depth 1,024 and sibling isolation.
- 183/183 chat messages. 497 pinned repository documents: zero unexpected differences against
  the committed per-document manifest. The eight known normalization differences remain explicit.
- 11,300 reproducible fuzz edits: zero fresh/incremental differences; negative control fails all checks.
- Native ASan/UBSan: 2,000 edits, 30,000 slices, 30,000 segmented blocks and 48,800 cursor comparisons.
- Packed Node, Bun and Vite/Chromium consumers: all nine runtime initialization/order combinations
  pass, including repeated initialization, both extension assets, the host wasm and license notices.

## Chromium preparation

Run `PLAYWRIGHT_BROWSERS_PATH=/work/cache/ms-playwright bun bench/preparation.mjs <baseline> <release>`.
The committed JSONL records the baseline ab81f6c and release source, browser version, three independent
contexts per fixture, payloads and all timings. Each run parses the complete source and compares
all four outputs to a fresh document after 80 edits. No prefix-only timings are used.

Median milliseconds across three runs, Chromium 153.0.8010.12. Columns show baseline → release.

| Fixture | Cold full parse | First visible outputs | Edit median / p95 |
| --- | ---: | ---: | ---: |
| Ordinary 46 KB | 5.9 → 6.3 | 1.7 → 1.6 | 0.1 / 0.2 → 0.1 / 0.2 |
| Document 1 MB | 43.5 → 41.4 | 1.1 → 1.1 | 0.3 / 0.4 → 0.2 / 0.3 |
| Giant paragraph 1.12 MB | 41.1 → 40.7 | 47.6 → 45.3 | 49.1 / 50.7 → 50.0 / 51.5 |
| 4,096 references, 92 KB | 43.2 → 40.9 | 1.4 → 1.6 | 7.2 / 7.3 → 7.0 / 7.3 |
| Giant fence 1.08 MB | 92.3 → 92.9 | 0.4 → 0.5 | 55.1 / 59.5 → 56.6 / 60.5 |

The 1 MB mixed document benefits from an idle reparse: 7.4 ms idle work reduces its first edit
from 9.6 ms to about 1.4 ms. Giant blocks remain expensive; idle work cannot make them fit a frame.
Use a worker for complete-document preparation and edits. A 16.7 ms frame and the Editor's 1–2 ms
input target rule out synchronous main-thread parsing for these supported inputs. Lazy inline
resolution still avoids parsing unrelated paragraphs, but one giant paragraph is one leaf.

The eight-document reserved wasm heap growth divided by eight is 0.45, 6.18, 20.80, 5.70 and
29.76 MiB respectively. This is allocator reservation growth, not exact live allocation, and does
not include JavaScript strings or embedded-language trees. Disposing documents makes allocations
reusable; WebAssembly linear memory does not shrink.

Payload: resolver 56,124 B gzip, grammar 25,982 B, wrapper 2,177 B, shared host JS 20,400 B and
shared host wasm 92,662 B: 197,345 B total gzip (192.72 KiB). Hosts already using the pinned
runtime add only the two modules and wrapper, 84,283 B (82.31 KiB). Raw total is 596,397 B.

Container nesting stops at 200, retaining deeper markers as source. This bounds scanner state.
Footnotes, math and CJK-specific flanking remain outside this release.
