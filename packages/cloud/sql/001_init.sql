-- 001_init.sql

-- Projects: один project = один независимый scope аннотаций.
-- secret_key_hash — sha256 от 'pk_<32 random chars>'. Никогда не храним plaintext.
create table projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  origin text,  -- свободное поле (https://staging.example.com), не идентификатор
  secret_key_hash text not null unique,
  created_at timestamptz not null default now()
);

-- Annotations: формат зеркалит web-remarq Annotation тип.
-- fingerprint целиком в JSONB — не нормализуем (нам этого не надо в MVP).
create table annotations (
  id text primary key,  -- web-remarq id (не uuid! shortid из клиента)
  project_id uuid not null references projects(id) on delete cascade,
  route text not null,
  viewport text not null,
  viewport_bucket integer not null,
  fingerprint jsonb not null,
  comment text not null,
  status text not null default 'pending',
  timestamp_ms bigint not null,  -- web-remarq timestamp (ms)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index annotations_project_route_idx on annotations(project_id, route);
create index annotations_project_status_idx on annotations(project_id, status);

-- RLS: client передаёт project key plaintext в заголовке `x-remarq-project-key`,
-- мы проверяем sha256(key) == secret_key_hash через current_setting().
-- Это безопасно потому что:
-- (a) ключ передаётся только по HTTPS,
-- (b) на сервере остаётся только хеш,
-- (c) anon key Supabase ограничен RLS-политиками.

alter table projects enable row level security;
alter table annotations enable row level security;

-- Helper: достаёт project_id по ключу из заголовка.
create or replace function current_project_id() returns uuid
  language plpgsql stable
as $$
declare
  key_header text;
  key_hash text;
  project uuid;
begin
  key_header := current_setting('request.headers', true)::json->>'x-remarq-project-key';
  if key_header is null then return null; end if;
  key_hash := encode(digest(key_header, 'sha256'), 'hex');
  select id into project from projects where secret_key_hash = key_hash limit 1;
  return project;
end;
$$;

-- Projects: видны только самим себе (через ключ); insert/update — через service role (out of scope MVP).
create policy projects_select on projects
  for select using (id = current_project_id());

-- Annotations: полный CRUD когда совпадает project_id.
create policy annotations_select on annotations
  for select using (project_id = current_project_id());
create policy annotations_insert on annotations
  for insert with check (project_id = current_project_id());
create policy annotations_update on annotations
  for update using (project_id = current_project_id())
  with check (project_id = current_project_id());
create policy annotations_delete on annotations
  for delete using (project_id = current_project_id());

-- digest() из pgcrypto extension.
create extension if not exists pgcrypto;
