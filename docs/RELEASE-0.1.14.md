# Release 0.1.14

GFM literal URLs now consume interior Markdown delimiters before emphasis resolves.
For example, `A **see(https://exa**mple.test/a)ded** message.` keeps the complete URL
inside the surrounding strong text. This changes the truncated URL and strong
ranges to their authored boundaries without changing emphasis rules.

Canonical URL decoding, `gfm-autolink` origin, raw `sourceValue` and `sourceUrl`
remain unchanged. Regression tests cover delimiter interiors, terminal punctuation,
entities, explicit links, code spans, CJK boundaries and incremental prefixes.
