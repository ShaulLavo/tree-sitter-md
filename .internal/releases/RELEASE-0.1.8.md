# Release 0.1.8

Added native unfinished-inline interpretation to `presentation({ input: 'open' })`.
Eligible final leaves can contain nested provisional emphasis and strike, code,
pending links, pending images and pending math. Pending links and images expose
received labels without a destination or title. Code and TeX retain received
content, including code whitespace normalization, without invented closing syntax.

Added `provisional` node paths and reasons, and `suppressed` source ranges for
ambiguous empty trailing inline markers. An empty suppressed paragraph is omitted.
EOF eligibility uses original source mapping through nested containers and footnotes.
Ended presentation and `semantics()` retain exact interpretation at the same revision.

Block-marker suppression, reference reporting and full streaming qualification
remain subsequent work. This release completes the inline phase of the native
AI chat streaming plan.
