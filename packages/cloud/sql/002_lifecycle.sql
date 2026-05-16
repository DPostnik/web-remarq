-- 002_lifecycle.sql
-- Adds lifecycle column for full audit trail (core v0.7.0 feature).
-- Backward-compat: existing rows get '[]'::jsonb; migrateAnnotation in core
-- synthesizes a `created` event on load if array is empty.

alter table annotations
  add column lifecycle jsonb not null default '[]'::jsonb;
