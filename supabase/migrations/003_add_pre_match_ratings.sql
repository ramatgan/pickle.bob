alter table matches
add column if not exists pre_match_ratings jsonb not null default '{}'::jsonb;
