-- User-configured egress proxies (Tools tab). The full URL — including
-- credentials when present — is wrapped in the same AES-256-GCM envelope as
-- the cookie vault before insert, so the column never holds a readable secret.
create table if not exists velo_proxy (
  id text primary key,
  url_encrypted text not null,
  protocol text not null check (protocol in ('http', 'socks5')),
  created_at timestamptz not null default now()
);