create table if not exists youtube_vault (
  user_id      text primary key,
  cookies      text not null,
  cookie_count integer not null default 0,
  updated_at   timestamptz not null default now()
);
