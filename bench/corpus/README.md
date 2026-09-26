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
another JSON array of strings. The runner also reads repository documentation
from the pinned Platform and Editor revisions described in its source.
