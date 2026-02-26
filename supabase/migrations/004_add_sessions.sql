create table if not exists sessions (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references groups(id) on delete cascade,
  started_at timestamptz not null default now()
);

create unique index if not exists idx_sessions_group_started_at on sessions(group_id, started_at);
create index if not exists idx_sessions_group_started on sessions(group_id, started_at desc);

alter table matches
  add column if not exists session_id uuid;

insert into sessions (group_id, started_at)
select
  group_id,
  date_trunc('day', created_at) as started_at
from matches
where session_id is null
group by group_id, date_trunc('day', created_at)
on conflict (group_id, started_at) do nothing;

update matches m
set session_id = s.id
from sessions s
where m.session_id is null
  and m.group_id = s.group_id
  and date_trunc('day', m.created_at) = date_trunc('day', s.started_at);

update matches m
set session_id = (
  select s.id
  from sessions s
  where s.group_id = m.group_id
  order by s.started_at desc, s.id desc
  limit 1
)
where m.session_id is null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'matches_session_id_fkey'
  ) then
    alter table matches
      add constraint matches_session_id_fkey
      foreign key (session_id) references sessions(id) on delete cascade;
  end if;
end
$$;

create index if not exists idx_matches_group_session_created
  on matches(group_id, session_id, created_at desc, id desc);

alter table matches
  alter column session_id set not null;
