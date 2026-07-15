-- cloud-0.3.0: persist the AI comment quality verdict
alter table annotations add column if not exists quality_check jsonb;
