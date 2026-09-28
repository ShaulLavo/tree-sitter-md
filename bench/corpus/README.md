# Chat corpus

`chat.json` contains the 183 assistant messages used for the chat measurements in
`docs/FINDINGS.md`. It is a JSON array of unmodified strings ordered by creation time.
The messages span 59 Platform sessions from September 5–25, 2026.

The corpus was originally exported from Platform's production SQLite state store
on September 26, 2026. The temporary exports were deleted after benchmarking.
This copy was recovered from the production backup dated `20260926T133030Z`
and published as test data at the owner's request.

Extraction query:

```sql
SELECT text
FROM projection_session_messages
WHERE role = 'assistant'
ORDER BY created_at;
```

Verification: 183 strings, 64,199 Unicode characters, 65,429 JSON bytes.
SHA-256: `2c5c01ed08af3c921c8c500b6c9f50d9e48d39480bedc91355dc88377e9adbf1`.

From `bench/`, run `node corpus.mjs`. Set `CHAT=/path/to/other.json` to use
another JSON array of strings. The runner also reads the committed repository snapshot described below.

## Repository corpus

`repositories.json.gz` contains 497 `{name, text}` records from all tracked `.md`
files in Platform `c130dd35a202dd06ccd160bd5ed0789c889315c2` and Editor
`74e76bef2af674ad80b3c13024fa47f692e2bb7c`. The exact per-document SHA-256 hashes
and permitted differences live in `tests/repository-differences.json`.
The runners read this committed snapshot; no repository checkout is needed in CI.

Regenerate it from checkouts containing those commits:

```sh
node scripts/snapshot-repositories.mjs /path/to/platform /path/to/Editor
```

The generator verifies names, order and every content hash before writing.
