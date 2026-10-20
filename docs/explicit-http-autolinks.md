# Explicit HTTP(S) autolinks

Literal `http://` and `https://` links accept a nonempty, validated host prefix without a dot. URL-internal brackets and emphasis markers remain part of the URL. Recognition runs before emphasis resolution, so `https://ex**ample.ssage` stays one link. The safe first-host-character, final-label underscore, Unicode decoding, CJK punctuation and bounded-domain checks remain active. The `www` and email policies are unchanged.

The existing text-node fallback excludes terminal `>` from explicit HTTP(S) links. The inline matcher retains internal angle punctuation. These paths differ in the reference implementation too. A global `>` stop would break the saved nested-scheme witness by truncating its outer link.

`tests/fixtures/autolink-boundaries.json` copies 16 independent saved observations from r122. It records original UTF-16 source hashes, raw observation pointers, expected link text, hrefs, ranges and attention ranges. Lone surrogates stay escaped in JSON and survive the source identity check. Expected values come from the saved reference output, never from this parser's result.

The regression tests check exact/ended links for all 16 observations, supported open links, completed attention, the URL-versus-strong witness, and incremental/fresh equality. They also record native open math ownership separately. These narrower green checks do not satisfy strict live acceptance. The unchanged strict diagnostic still reports four seed230 revisions47/48 open URL failures because an unclosed math node owns the suffix, and seed235 revision19 live has an extra emphasis at 35..74. The live expected links and attention remain unchanged in the fixture. Fixing those other producers requires their own scope.

This patch does not establish resolution of all 415 URL observations. Seed212 live revisions18/19 and the full product qualification remain unverified. Release numbering and downstream consumption belong to the integration owner.
