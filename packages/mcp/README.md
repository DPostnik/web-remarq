# @web-remarq/mcp

MCP server for [web-remarq](https://github.com/DPostnik/web-remarq) — gives AI
agents (Claude Code, Cursor, Codex, Windsurf) direct access to project
annotations. Two modes: **local** (zero-config, file-backed, no account
needed) and **cloud** (Supabase-backed via `@web-remarq/cloud`, for team sync).

## What it does

- Lists annotations with filters by route, status, viewport, or file substring
- Returns full annotation details including `source: { file, line, column }`
  for the annotated element and grep-friendly search hints
- Drives the lifecycle: `acknowledge` (pending → in-progress), `claim_fix`
  (→ fixed_unverified), `dismiss` (with optional reason)
- `watch_annotations` long-polls for new pending feedback, so an agent can sit
  in a loop and react as a designer annotates
- All MCP-driven changes are recorded as `actor: 'agent'` in the annotation's
  lifecycle history, visible in the widget's History viewer

`verify` and `reject` are **not** exposed — verification is human-only via the
browser widget, by design (core v0.7.0 verification gate).

## Local mode (no Supabase)

Run with no `REMARQ_*` cloud env vars set and the server starts in local mode
automatically:

```json
{
  "mcpServers": {
    "web-remarq": {
      "command": "npx",
      "args": ["-y", "@web-remarq/mcp"]
    }
  }
}
```

Annotations are stored in a JSON file on disk and served to the widget over a
small HTTP endpoint on `127.0.0.1`. No Supabase project, no project key.

| Env var | Default | Purpose |
|---------|---------|---------|
| `REMARQ_PORT` | `1817` | Port for the widget-facing HTTP endpoint |
| `REMARQ_DATA_FILE` | `.remarq/annotations.json` | Where annotations are persisted |

`.remarq/` self-gitignores on first write - nothing to add to your project's
`.gitignore` by hand.

On the widget side, pair it with `HttpStorageAdapter` and `submitFlow`:

```typescript
import { WebRemarq, HttpStorageAdapter } from 'web-remarq'
WebRemarq.init({ submitFlow: true, storage: new HttpStorageAdapter() })
```

### Access model (mcp 0.5.0, protocol 2)

On first start the server writes `.remarq/config.json`:

```json
{
  "projectId": "prj_…",          // stable identity of this store
  "token": "…",                  // random bearer credential for the HTTP endpoint
  "allowedOrigins": ["http://localhost:*", "http://127.0.0.1:*", "http://[::1]:*"]
}
```

`npx @web-remarq/cli init` creates the same file up front. It is owner-only
and gitignored; the token never appears in source, URLs, ticket files, logs or
`doctor` output.

Every request except `GET /health` needs `Authorization: Bearer <token>` -
reads included. Browser requests must also come from an origin in
`allowedOrigins` (exact scheme + host; `:*` means any port). Foreign, `null`
and look-alike origins (`localhost.evil.com`) are refused on preflight, read
and write; a `Host` header that does not name this loopback listener is
refused too (DNS rebinding). Remote/staging origins are never allowed unless
you list them on purpose.

How the widget gets the token, in development only:

- **Vite**: `@web-remarq/unplugin` serves it at `/__web-remarq/config.json`
  on your dev server; `HttpStorageAdapter` fetches it same-origin.
- **Next.js**: `withRemarq()` exposes it as `NEXT_PUBLIC_WEB_REMARQ_TOKEN`;
  the `RemarqDevTools` snippet passes it as `new HttpStorageAdapter({ token })`.
- **Plain HTML / other bundlers**: paste it once in the browser console -
  `WebRemarq.pair('<token>')` - it is kept in localStorage for that endpoint.

Rotating the token (edit the file, restart the server) does not change
`projectId` and does not touch annotations; widgets show "not paired" until
they get the new token. Changing `projectId` is a different project: widgets
keep their queued changes for the old one.

What this protects: the HTTP boundary, against other pages in your browser
and against rebinding attacks. What it does not protect: a process on your
machine with file access (it can read `.remarq/config.json`), and it is not a
cryptographic "human approval" - the lifecycle records who acted, it does not
authenticate them.

### Protocol 2 endpoints

| Route | Auth | Purpose |
|-------|------|---------|
| `GET /health` | none, any origin | `{ ok, protocol: 2 }` - liveness only, no data |
| `GET /store` | token | `{ rev, protocol, projectId, store }`; every annotation carries its own `rev` |
| `PUT /annotations/:id` | token | Create (no `If-Match`) or update (`If-Match: <rev>` required). Body is validated (types, enums, sizes, filename-safe id, unknown top-level fields rejected). Wrong revision → `409 { code: "conflict", details: { current } }`; missing → `428` |
| `DELETE /annotations/:id` | token | Optional `If-Match`; mismatch → 409 |
| `DELETE /annotations` | token | Clear |

Limits: 512 KB body, 10 000-character comments, 500 lifecycle events,
`application/json` only. An invalid request is a 4xx and changes neither the
store nor `.remarq/tasks/`.

**Upgrading from mcp 0.4.x**: widgets older than `web-remarq` 0.9.0 get 401
from a 0.5.0 server and go into their offline buffer instead of losing data;
upgrade the widget and the buffer is migrated (see "Offline and durability" in
the core README). A 0.9.0 widget refuses to talk to a 0.4.x server
("incompatible") rather than writing without revisions.

Only one server may serve a store: `.remarq/server.lock` names the owning
process, and a second start against the same store exits with an error. The
atomic transition guarantee below depends on this.

### Atomic transitions

`acknowledge`, `claim_fix` and `dismiss` are atomic per annotation: the read,
the lifecycle check and the write happen inside one critical section (local
file store) or as one conditional `UPDATE … WHERE id = ? AND rev = ?` (cloud,
needs `004_rev.sql`). Of several concurrent callers exactly one wins; the
others get `invalid_transition` with `details.conflict: true`, the current
status/revision and the last event - do not start work, re-read the annotation.

Pass `operationId` (any unique string you keep) to make a call idempotent: a
retry after a lost response finds the event already recorded and returns
`{ ok: true, replayed: true }` instead of appending a second one. A different
`operationId` never impersonates the earlier winner.

The guarantee is "one winner per transition", not "an authenticated owner":
nothing identifies which agent won, the lifecycle records `actor: 'agent'`.
Cloud mode has the same contract through the conditional update; the
disposable-database run that proves it against real Postgres is still an open
verification step (the adapter tests assert the exact statement, not SQL
atomicity).

### Watching for new feedback

`watch_annotations` returns immediately if pending annotations already exist;
otherwise it blocks (long-poll) until one appears or `timeoutSeconds` elapses
(default 25, max 120), then returns `{ annotations: [], total: 0, timedOut: true }`.
Drafts are never delivered by `watch_annotations` - only annotations a designer
has submitted. `list_annotations` / `get_annotation` can still return drafts
when queried directly.
Typical agent loop:

```
loop:
  result = watch_annotations({ timeoutSeconds: 25 })
  if result.timedOut: continue
  for each annotation in result.annotations:
    acknowledge({ id: annotation.id })   # stop it from being redelivered
    ... work the fix ...
```

### Parallel mode (dispatcher + background subagents)

The serial loop above blocks on each fix: feedback that arrives while the
agent is editing waits its turn. If the client can run background subagents
(Claude Code's Task tool, for example), run the main agent as a dispatcher
instead - acknowledge, hand off, return to watching:

```
loop:
  result = watch_annotations({ timeoutSeconds: 60 })
  if result.timedOut: continue
  for each annotation in result.annotations:
    acknowledge({ id: annotation.id })   # BEFORE dispatch - closes the
                                         # redelivery window while the
                                         # subagent spins up
    dispatch background subagent:        # fix the files, then claim_fix
  # do not wait for subagents - go straight back to watch_annotations
```

The server ships this recipe as an MCP prompt: in clients that support them
(Claude Code renders it as the `/mcp__web-remarq__watch` slash command) one
command puts the agent on duty - no copy-paste needed. For clients without
MCP-prompt support, paste this instead:

> You are on annotation duty for this project. Designers drop feedback via
> the web-remarq MCP server. Run this loop until I tell you to stop: call
> `watch_annotations` (timeoutSeconds: 60); if it times out, call it again.
> For EACH annotation it returns, call `acknowledge` with its id first, then
> dispatch a background subagent that applies the fix to the project files
> and calls `claim_fix` when done. Do not fix anything yourself in the main
> loop and do not wait for subagents - go straight back to
> `watch_annotations` so new feedback is never missed. If a comment is
> ambiguous or unactionable, `dismiss` it with a reason instead of guessing.

## Ticket folder: `.remarq/tasks/`

In local mode the server also maintains `.remarq/tasks/` - a live projection of
actionable annotations (`pending` / `in_progress`). Each one is a `<id>.md`
ticket: YAML frontmatter (id, route, status), the designer's comment,
source `file:line:col` + grep search hints, and instructions to report back
via the MCP tools. Files appear when an annotation is submitted, update on
status changes, and disappear once it is verified or dismissed. The folder is
server-owned - never edit or commit it (`.remarq/` self-gitignores).

Caveat: with a custom `REMARQ_DATA_FILE` pointing outside `.remarq/`, the
`tasks/` folder is created next to your data file and is NOT auto-gitignored -
add it to your `.gitignore` yourself.

There is no mode switch:

- **Agent on duty** (watching via `watch_annotations`): the folder just mirrors
  state while fixes flow through the live loop.
- **No agent running**: the folder is your backlog. Later, tell any agent:

  > Work through the tickets in .remarq/tasks/, one background subagent per
  > file, in parallel. Follow the instructions inside each file.

Duplicate work is prevented by the atomic lifecycle transition, not by file
locks: the first thing any executor does is `acknowledge` with a fresh
`operationId` - if it answers `invalid_transition`, someone else already moved
the annotation and the file should be skipped; if the call fails without an
answer, retry with the same `operationId`.

## Cloud mode prerequisites

1. A Supabase project provisioned with `@web-remarq/cloud` (≥0.4.0). Run
   `001_init.sql`, `002_lifecycle.sql`, `003_quality.sql` and `004_rev.sql`
   from the cloud package (all additive).
2. A project key generated via `npx @web-remarq/cloud gen-key --name "..."`.

## Configuration

Add to your editor's MCP config. For Claude Code: use `claude mcp add` CLI or
edit `~/.claude.json` directly. For Cursor: `~/.cursor/mcp.json`. Other editors:
consult their MCP setup docs. The JSON shape is the same across editors:

```json
{
  "mcpServers": {
    "web-remarq": {
      "command": "npx",
      "args": ["-y", "@web-remarq/mcp"],
      "env": {
        "REMARQ_PROJECT_KEY": "pk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
        "REMARQ_SUPABASE_URL": "https://abc.supabase.co",
        "REMARQ_SUPABASE_ANON_KEY": "eyJ..."
      }
    }
  }
}
```

Setting any one of `REMARQ_PROJECT_KEY` / `REMARQ_SUPABASE_URL` /
`REMARQ_SUPABASE_ANON_KEY` switches the server to cloud mode, and then all
three are required - the server exits with code 1 and a clear stderr message
if any are missing or malformed. Leave all three unset for local mode.

## Tools

| Tool | Input | Returns |
|------|-------|---------|
| `list_annotations` | `{ route?, status?, viewportBucket?, file?, limit? }` | `{ annotations[], total }` - `status` accepts `draft`, `pending`, `in_progress`, `fixed_unverified`, `verified`, `dismissed`; each item carries `quality` (`clear` \| `ambiguous` \| `unactionable`) when an AI pre-flight check ran |
| `get_annotation` | `{ id }` | Full `AgentAnnotation` shape (source + searchHints + lifecycle + `qualityCheck` when present) |
| `acknowledge` | `{ id, operationId? }` | `{ ok, status, rev, replayed? }` after `pending → in_progress` (atomic, one winner) |
| `claim_fix` | `{ id, operationId? }` | `{ ok, status, rev, replayed? }` after `pending\|in_progress → fixed_unverified` |
| `dismiss` | `{ id, reason?, operationId? }` | `{ ok, status, rev, replayed? }` after non-terminal → `dismissed` |
| `watch_annotations` | `{ timeoutSeconds? }` (1-120, default 25) | `{ annotations[], total, timedOut }` - long-polls for new pending annotations |

When `qualityCheck.score` is `ambiguous` or `unactionable`, the comment likely needs designer clarification — prefer `dismiss` with a reason over guessing at intent.

### Error codes

- `annotation_not_found` — id absent in project (also returned if RLS hides it)
- `invalid_transition` — lifecycle action not allowed from current status. `details` carries `conflict: true`, `currentStatus`, `currentRev`, `lastEvent` and `requestedTransition`: treat it as "someone else got there first" - do not start work, re-read the annotation. Storage adapters without `mutate()` (custom ones) answer `atomic: false` on success
- `storage_error` - Supabase / network failure in cloud mode, or a local
  file-store error (e.g. corrupted store) in local mode; payload includes root
  cause
- `validation_error` — input failed zod schema (auto from MCP SDK)

## License

MIT
