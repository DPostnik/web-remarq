-- 004_rev.sql (cloud 0.4.0)
-- Per-record revision for optimistic concurrency. Every accepted write bumps it;
-- clients send the revision they last read and the adapter updates with
-- `... where id = $1 and rev = $expected` in ONE statement, so two concurrent
-- transitions on the same annotation cannot both succeed (the second sees zero
-- matched rows and re-reads). Existing rows start at 1. Additive - nothing else changes.
alter table annotations add column if not exists rev integer not null default 1;
