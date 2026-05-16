# @web-remarq/mcp

MCP server for [web-remarq](https://github.com/DPostnik/web-remarq) — gives AI
agents (Claude Code, Cursor, Codex, Windsurf) direct access to project
annotations stored in the cloud backend (`@web-remarq/cloud`).

## What it does

- Lists annotations with filters by route, status, viewport, or file substring
- Returns full annotation details including `source: { file, line, column }`
  for the annotated element and grep-friendly search hints
- Drives the lifecycle: `acknowledge` (pending → in-progress), `claim_fix`
  (→ fixed_unverified), `dismiss` (with optional reason)
- All MCP-driven changes are recorded as `actor: 'agent'` in the annotation's
  lifecycle history, visible in the widget's History viewer

`verify` and `reject` are **not** exposed — verification is human-only via the
browser widget, by design (core v0.7.0 verification gate).

## Prerequisites

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

All three env vars are required. The server exits with code 1 and a clear
stderr message if any are missing or malformed.

## Tools

| Tool | Input | Returns |
|------|-------|---------|
| `list_annotations` | `{ route?, status?, viewportBucket?, file?, limit? }` | `{ annotations[], total }` |
| `get_annotation` | `{ id }` | Full `AgentAnnotation` shape (source + searchHints + lifecycle) |
| `acknowledge` | `{ id }` | `{ ok, status }` after `pending → in_progress` |
| `claim_fix` | `{ id }` | `{ ok, status }` after `pending\|in_progress → fixed_unverified` |
| `dismiss` | `{ id, reason? }` | `{ ok, status }` after non-terminal → `dismissed` |

### Error codes

- `annotation_not_found` — id absent in project (also returned if RLS hides it)
- `invalid_transition` — lifecycle action not allowed from current status; payload includes `currentStatus`
- `storage_error` — Supabase / network failure; payload includes root cause
- `validation_error` — input failed zod schema (auto from MCP SDK)

## License

MIT
