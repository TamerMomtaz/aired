# AIRED · MCP server — the delegated publish door

One tool, `aired_publish_work`, so a finished work can be carried to AIRED from
an agent context. It is a thin wrapper over `POST /api/works/ingest`: the same
route, the same token, the same `published_via = 'delegated_api'` stamp, the same
honesty trigger, the same draft state. **Convenience, not a second code path.**

## What it is not

It uploads a local master through a short-lived signed URL rather than inline, so
a full-length track is not capped by any request-body limit (CLAUDE.md Rule 4).

It does not publish anything on its own, and nothing here should ever be
described as if it did. A **human holds the token** this server carries, the work
lands as a **draft**, and a human still promotes it to live from Manage. The
ledger records that the work arrived through delegated authority and names the
human who authorized it. That honesty is the feature.

## Install & run

```bash
cd mcp
npm install
AIRED_INGEST_SECRET=… npm start        # speaks MCP over stdio
```

| Variable | Required | Notes |
| --- | --- | --- |
| `AIRED_INGEST_SECRET` | yes | The delegated token. Read from this server's own environment — never a tool argument, never echoed in a result or a log. AIRED resolves it to the authorizing human **and** the performer the work files under; neither is chosen by the caller. |
| `AIRED_API_BASE` | no | Defaults to `https://ai-red.io`. |

Register it with any MCP client, e.g.:

```json
{
  "mcpServers": {
    "aired": {
      "command": "node",
      "args": ["/path/to/aired/mcp/src/index.js"],
      "env": { "AIRED_INGEST_SECRET": "…" }
    }
  }
}
```

## The tool

`aired_publish_work` — "Publish a finished, human-authorized work to AIRED as a
draft, via delegated API."

| Input | Required | Notes |
| --- | --- | --- |
| `title` | yes | The catalog number (AIRED-####) is assigned by AIRED. |
| `audio.master_path` | one of | A master already in the private `masters` bucket, inside the authorizing artist's own folder. **Preferred** — a long track never passes through a request body. |
| `audio.file_path` | one of | A local file, sent inline as multipart. Subject to the platform's request-body limit. |
| `artwork.path` / `artwork.file_path` | no | Same two forms, into the public `artwork` bucket. |
| `placement` | no | `{ mode: "single" \| "album" \| "new_album", album_id, new_album_title, new_album_description }`. Defaults to a single. |
| `descriptors` | no | Public, searchable sonic descriptors — what it SOUNDS LIKE. Never a person's name; the reference-sanitizer drops names before any public write and reports them back as `dropped_names`. |
| `duration_seconds` | no | Omit and the song has no known length until you set one. |
| `volley` | no | The Volley Ledger: `{ seq, contributor: { name, type }, role, origin, delta_type, craft }` per move. Contributors are credited **by name**, always public, resolved find-or-create so one maker keeps one page. `contributor.type` is required only the first time a name appears (that row becomes their page, so it is never guessed); a known name keeps its own type. `craft` is sealed — encrypted, creator-owned, never served. |
| `idempotency_key` | yes | A uuid you mint per work. Re-send the **same** key to retry safely: the existing draft comes back instead of a duplicate. |

Returns the catalog number, the draft id, `published_via`, the authorizing human,
the token label, and the volley count — never the token or any secret.
