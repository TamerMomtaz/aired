# `scripts/` — run-it-yourself publishing

One script, `publish-work.mjs`, for carrying a finished master to AIRED from your
own machine. It is the three `curl` calls already documented in the root
[`README.md`](../README.md#full-length-masters--postapiworksupload-url) with the
fiddly parts handled: ask for a signed upload grant, PUT the master straight to
the private `masters` bucket, then publish.

**Same route, same token, same stamp, same draft.** It is not a second code path
and it holds no logic of its own — `published_via = 'delegated_api'`, the
`enforce_publish_honesty` trigger, the reciprocal ledger and draft-on-arrival all
live server-side and are untouched by anything here.

**It does not publish anything.** A human holds the token, the work lands as a
**draft**, and a human still promotes it from `/manage` with Go Live.

## Run it

```bash
# 1 · validate the manifest — no network, no upload, no token needed
node scripts/publish-work.mjs scripts/works/a-way-to-see.json --dry-run

# 2 · publish for real
AIRED_INGEST_SECRET='…' node scripts/publish-work.mjs \
  scripts/works/a-way-to-see.json \
  --master ~/path/to/AISong_orgA_WAY_TO_SEE_1_1.mp3
```

Node 22+, no dependencies, nothing to install.

The secret is read **only** from the environment. It is never accepted as a
command-line argument (that would put it in your shell history), never printed,
never logged, and never written to a file. The signed upload URL the door hands
back is itself a credential, so that is redacted from the output too — you see
the destination *path*, not the URL.

| Variable | Required | Notes |
| --- | --- | --- |
| `AIRED_INGEST_SECRET` | yes | The delegated token. AIRED resolves it to the authorizing human **and** the performer the work files under — neither is chosen here. |
| `AIRED_API_BASE` | no | Defaults to `https://ai-red.io`. Also `--api-base`. |

| Flag | What |
| --- | --- |
| `--master <file>` | The local master to upload. |
| `--master-path <path>` | Skip the upload and publish a master already in the bucket — **this is the retry path** if the upload succeeded but the publish failed. |
| `--dry-run` | Validate and print the exact payload. Touches no network, needs no token. |
| `--show-craft` | Print craft values in `--dry-run` (redacted by default — see below). |

## Why validate locally first

If **any** volley is refused server-side, the whole work row is deleted so
nothing half-made keeps an AIRED number. That is the right behaviour, but it
means one typo costs an upload and a round trip. So the script checks the ledger
vocabulary (`role` / `origin` / `delta_type` / contributor `type`) against
`src/lib/ledger/types.ts` before it opens a socket, and mirrors the
`enforce_volley_origin` trigger exactly — an `ai_model` may never carry a `HUMAN`
origin, a `human` may never carry an `AI` one, and `DIALOGUE`, the *neither
alone* move, is legal for anyone.

Craft is redacted when a payload is echoed. Verbatim prompts live only in the
encrypted `private_volley` (Rule 1); they should not land in a terminal
scrollback or a CI log as a side effect of a dry run.

## The manifest

One JSON file per work, in `works/`. Keys starting with `_` are notes and are
ignored. The interesting ones:

- **`idempotency_key`** — minted once and **pinned in the file**. Re-running
  re-sends the same key, so a retry returns the draft it already created instead
  of minting a second AIRED number.
- **`descriptors`** — public, searchable, sanitized: what it **sounds** like,
  never a person's name (Rule 2). Left empty is honest; invented is not.
- **`expect.performer`** — checked against the response. The *token* decides the
  performer; this just catches the wrong token before you find the work on the
  wrong artist page.
- **`volley`** — the ledger. Contributors are credited **by name**, always
  public (Rule 3a).

### Names must match the existing rows exactly

Contributor names resolve **find-or-create**: matched on the derived slug first,
then case-insensitively. A name that doesn't match mints a **new** agent row
rather than failing — so a misspelling doesn't error, it quietly splits a maker's
discography across two pages. The names in `works/a-way-to-see.json` were copied
verbatim from the live `agent` table for exactly this reason.

The live table already shows what this costs when it drifts: `Suno` and
`Suno AI`, `Taim` / `Taim Tamer` / `Taim Tamer Momtaz`, and a row literally named
`art work - the thumbnail  chatGPT` are all separate contributor pages today.
Worth a cleanup pass at some point; until then, copy names, don't type them.

### The hands are appended for you

Every delegated work gets one volley the caller did not send and **cannot omit**:
the authorizing human, role `audit`, origin `HUMAN`, stating that they carried it
to shore and explicitly *not* that they authored it
(`src/lib/ingest/publish.ts:480`). Do not list that volley in a manifest — it
would be written twice.

### Adding a `lyric_thrown` volley

`a-way-to-see.json` credits **(&) CEE** with `lyric_caught`, which records a catch
of something the trail never records being thrown — and the auto `audit` volley
says in as many words that the human did not author it. If the words were in fact
thrown by a human first, that move belongs in the ledger. Paste this as the new
`seq: 0` and renumber the rest:

```json
{
  "seq": 0,
  "contributor": { "name": "Tee Momtaz", "type": "human" },
  "role": "lyric_thrown",
  "origin": "HUMAN",
  "delta_type": "added"
}
```

## After the first successful publish

A re-run with the same `idempotency_key` is a **pure replay**: it returns the
existing draft and applies **nothing** — no new title, no artwork, no extra
volleys (`src/lib/ingest/publish.ts:329`). That is what makes retries safe, and
it also means the manifest stops being the source of truth the moment the work
exists.

So everything after the first publish happens in the app, not here:

- **Artwork** — add the cover on the work's editor.
- **The artwork volley** — declare it in the ledger editor on `/registry/<id>`,
  crediting the executor by name. `chatGPT` and `Gemini` both already exist as
  contributor rows, so use those exact spellings; the role is `artwork` and the
  origin is `AI`.
- **A mislabelled volley** — `role`, `origin` and `delta_type` are editable in
  place by the owner (`public_volley_owner_upd`). Correcting one does **not**
  touch the sealed craft or its `private_hash`, so no re-seal is needed and the
  Red Line stays intact. A mislabel is a five-second fix, never a re-publish.
