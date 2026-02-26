create extension if not exists pgcrypto;

drop table if exists matches cascade;
drop table if exists players cascade;
drop table if exists groups cascade;

create table groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  pin_hash text not null,
  created_at timestamptz not null default now()
);

create table players (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references groups(id) on delete cascade,
  name text not null,
  rating numeric(4,2) not null,
  is_present boolean not null default false,
  games_since_played integer not null default 0,
  games_played integer not null default 0,
  created_at timestamptz not null default now()
);

create table matches (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references groups(id) on delete cascade,
  created_at timestamptz not null default now(),
  players uuid[] not null,
  team_a uuid[] not null,
  team_b uuid[] not null,
  score_a integer not null,
  score_b integer not null,
  rating_deltas jsonb not null default '{}'::jsonb,
  pre_match_ratings jsonb not null default '{}'::jsonb,
  check (array_length(players, 1) = 4),
  check (array_length(team_a, 1) = 2),
  check (array_length(team_b, 1) = 2),
  check (score_a >= 0),
  check (score_b >= 0)
);

create index idx_groups_slug on groups(slug);
create index idx_players_group_id on players(group_id);
create index idx_matches_group_created on matches(group_id, created_at desc);
