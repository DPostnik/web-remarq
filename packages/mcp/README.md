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

Trust model: the endpoint binds to `127.0.0.1` with permissive CORS, so any
page open in the local browser can reach it for as long as the server runs -
this is meant for dev-time use with low-sensitivity data, not a hardened
local API.

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

Copy-paste prompt to put an agent on duty in this mode:

> You are on annotation duty for this project. Designers drop feedback via
> the web-remarq MCP server. Run this loop until I tell you to stop: call
> `watch_annotations` (timeoutSeconds: 60); if it times out, call it again.
> For EACH annotation it returns, call `acknowledge` with its id first, then
> dispatch a background subagent that applies the fix to the project files
> and calls `claim_fix` when done. Do not fix anything yourself in the main
> loop and do not wait for subagents - go straight back to
> `watch_annotations` so new feedback is never missed. If a comment is
> ambiguous or unactionable, `dismiss` it with a reason instead of guessing.

## Cloud mode prerequisites

1. A Supabase project provisioned with `@web-remarq/cloud` (≥0.2.0). Run both
   `001_init.sql` and `002_lifecycle.sql` from the cloud package.
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
| `acknowledge` | `{ id }` | `{ ok, status }` after `pending → in_progress` |
| `claim_fix` | `{ id }` | `{ ok, status }` after `pending\|in_progress → fixed_unverified` |
| `dismiss` | `{ id, reason? }` | `{ ok, status }` after non-terminal → `dismissed` |
| `watch_annotations` | `{ timeoutSeconds? }` (1-120, default 25) | `{ annotations[], total, timedOut }` - long-polls for new pending annotations |

When `qualityCheck.score` is `ambiguous` or `unactionable`, the comment likely needs designer clarification — prefer `dismiss` with a reason over guessing at intent.

### Error codes

- `annotation_not_found` — id absent in project (also returned if RLS hides it)
- `invalid_transition` — lifecycle action not allowed from current status; payload includes `currentStatus`
- `storage_error` - Supabase / network failure in cloud mode, or a local
  file-store error (e.g. corrupted store) in local mode; payload includes root
  cause
- `validation_error` — input failed zod schema (auto from MCP SDK)

## License

MIT
