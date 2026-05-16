# Supabase setup for `@web-remarq/cloud`

Run this once per Supabase project. Takes ~5 minutes.

## 1. Apply the schema

1. Open your Supabase project → **SQL Editor** → **New query**.
2. Copy the entire contents of [`001_init.sql`](./001_init.sql) into the editor.
3. Click **Run**. You should see `Success. No rows returned.`

This creates two tables (`projects`, `annotations`), enables row-level security,
and installs the `current_project_id()` helper that gates all access by the
`x-remarq-project-key` header.

## 2. Verify the schema

In a new query, run:

```sql
select * from projects;
select * from annotations;
```

Both should return zero rows (not an error). If either errors with
`relation does not exist`, step 1 did not complete — re-run it.

## 3. Generate a project key

From your local machine:

```sh
npx @web-remarq/cloud gen-key --name "My App"
```

Optionally pass `--origin "https://staging.example.com"` to tag the project
with a human-readable origin (free-form, not used for auth).

The script prints three things:

- The project key (`pk_...`) — your clients use this at runtime.
- Its sha256 hash — what Supabase stores.
- A ready-to-paste `insert` snippet.

## 4. Register the project in Supabase

1. Copy the printed `insert into projects ...` snippet.
2. Paste it into the SQL Editor → **Run**.
3. Confirm with `select id, name, origin, created_at from projects;` — your
   project row should appear.

## 5. Store the project key

Save the printed `pk_...` value in a password manager (1Password, Bitwarden,
etc.). It is **not recoverable** — only the hash is stored server-side. If you
lose it, generate a new one and replace the row in `projects`.

You are now ready to call `createCloudStorage({ projectKey: 'pk_...', ... })`
from your app. See the package README for the runtime API.
