alter table matches
add column if not exists rating_deltas jsonb not null default '{}'::jsonb;
