# @web-remarq/cloud

Cloud storage adapter for [web-remarq](../core/). Sync annotations across team members through Supabase.

[![npm](https://img.shields.io/npm/v/@web-remarq/cloud)](https://www.npmjs.com/package/@web-remarq/cloud) [![license](https://img.shields.io/npm/l/@web-remarq/cloud)](../../LICENSE)

## What it does

Replaces the default `LocalStorageAdapter` with a Supabase-backed one. Annotations made by anyone with the same project key sync to a shared backend, so designers and developers see the same set of markers across browsers and devices. Self-host Supabase — the free tier is enough for a team.

## Install

```bash
npm install @web-remarq/cloud @supabase/supabase-js
```

`@supabase/supabase-js` is a peer dependency — bring your own version so it isn't duplicated in your bundle.

## Setup (10 minutes)

### 1. Create a Supabase project

Go to [dashboard.supabase.com](https://dashboard.supabase.com), create a new project on the free tier, and save the `Project URL` and `anon public` key from Settings → API.

### 2. Apply the schema

Copy the contents of [`sql/001_init.sql`](./sql/001_init.sql) into Supabase Studio → SQL Editor → New query → Run. Creates `projects`, `annotations`, RLS policies, and the `current_project_id()` helper.

### 3. Generate a project key

```sh
npx @web-remarq/cloud gen-key --name "My App"
```

Save the printed `pk_...` key — it can't be recovered. Paste the generated `insert into projects ...` snippet into Supabase Studio → SQL Editor → Run.

### 4. Wire it up

```ts
import { WebRemarq } from 'web-remarq'
import { createCloudStorage } from '@web-remarq/cloud'

WebRemarq.init({
  storage: createCloudStorage({
    supabaseUrl: import.meta.env.VITE_SUPABASE_URL,
    supabaseAnonKey: import.meta.env.VITE_SUPABASE_ANON_KEY,
    projectKey: import.meta.env.VITE_REMARQ_PROJECT_KEY,
  })
})
```

## API

### `createCloudStorage(options): StorageAdapter`

Returns a `StorageAdapter` you can pass to `WebRemarq.init({ storage })`.

Options:

- `supabaseUrl` (required) — your Supabase project URL
- `supabaseAnonKey` (required) — anon/publishable key (safe to ship to the browser — RLS gates everything)
- `projectKey` (required) — `pk_...` key you generated in step 3
- `onError` (`'throw' | 'memory-fallback'`, default `'throw'`) — what to do when a Supabase call fails

### `createPreflightChecker(config, client?)`

Adapts the AI comment pre-flight check to core's `qualityGate.check` signature — one line of wiring:

```ts
import { WebRemarq } from 'web-remarq'
import { createPreflightChecker } from '@web-remarq/cloud'

WebRemarq.init({
  qualityGate: {
    check: createPreflightChecker({ provider: 'openai', apiKey: import.meta.env.VITE_OPENAI_KEY }),
  },
})
```

Config:

- `provider` (required) — `'anthropic' | 'openai'`
- `apiKey` (required) — your provider API key (BYOK)
- `model` (optional) — defaults to `claude-haiku-4-5` (Anthropic) / `gpt-5-nano` (OpenAI)

> **BYOK warning:** the key is visible in the browser. Fine for local dev and dogfooding; for anything shared, put the LLM call behind a server-side proxy route and pass a custom `check` function that hits your route instead.

Persisting verdicts to Supabase requires the `003_quality.sql` migration (see Upgrading below).

### `generateProjectKey(): string`

Generates a `pk_<32 random chars>` key. Browser-safe (uses Web Crypto).

### `hashProjectKey(key): Promise<string>`

SHA-256 hex (64 chars) of the key. This is what the database stores.

## Security

- The anon key is **safe** in the browser. Supabase RLS gates every operation by the project key sent in the `x-remarq-project-key` header.
- The project key acts like a shared password — anyone with it has full read/write access to your annotations. **Treat it as a secret.**
- The database only ever stores the SHA-256 hash of the project key, never the plaintext.
- If a key leaks, generate a new one (step 3) and delete the old project row in Supabase Studio.

## Limits (cloud-0.1.0 MVP)

- One project key per team — no user accounts yet
- No realtime sync — refresh the page to pick up other people's changes (coming in cloud-0.2.0 with MCP server + team UX)
- No web dashboard — manage annotations via Supabase Studio for now
- Two tabs editing the same annotation: last write wins

## Upgrading to 0.3.0

`@web-remarq/cloud@0.3.0` persists the AI quality verdict (`qualityCheck`, core ≥0.7.13)
in a new `quality_check` column. Run the additive migration in your Supabase SQL Editor:

```sql
-- packages/cloud/sql/003_quality.sql
alter table annotations add column if not exists quality_check jsonb;
```

Safe on production data — existing rows just read back with no verdict.

## Upgrading from 0.1.x

`@web-remarq/cloud@0.2.0` adds a `lifecycle` column to the `annotations` table
for full audit-trail persistence (core v0.7.0 feature). Run the additive
migration in your Supabase SQL Editor **before** installing the new version:

```sql
-- packages/cloud/sql/002_lifecycle.sql
alter table annotations
  add column lifecycle jsonb not null default '[]'::jsonb;
```

The migration is safe to run on production data. Existing rows get an empty
array; the core's `migrateAnnotation` synthesizes a `created` event on load
when lifecycle is empty.

## License

MIT
