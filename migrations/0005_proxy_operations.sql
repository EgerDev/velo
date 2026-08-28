-- Durable operator-managed proxy health and sanitized validation history.
-- Credentials remain encrypted in velo_proxy.url_encrypted; this migration
-- neither reads nor rewrites that value.
alter table velo_proxy add column credential_fingerprint text;
alter table velo_proxy add column priority integer;
alter table velo_proxy add column enabled boolean not null default true;
alter table velo_proxy add column eligible boolean not null default true;
alter table velo_proxy add column verdict text not null default 'unknown';
alter table velo_proxy add column last_checked_at timestamptz;
alter table velo_proxy add column last_evidence_at timestamptz;
alter table velo_proxy add column hard_failures integer not null default 0;
alter table velo_proxy add column full_passes integer not null default 0;
alter table velo_proxy add column last_error_code text;

with ranked as (
  select id, row_number() over (order by created_at, id)::integer as priority
  from velo_proxy
)
update velo_proxy
set priority = ranked.priority
from ranked
where velo_proxy.id = ranked.id;

alter table velo_proxy alter column priority set not null;
alter table velo_proxy add constraint velo_proxy_priority_positive check (priority > 0);
alter table velo_proxy add constraint velo_proxy_priority_unique unique (priority);
alter table velo_proxy add constraint velo_proxy_verdict_valid check (
  verdict in ('unknown', 'checking', 'healthy', 'degraded', 'blocked', 'unreachable', 'unsafe_tls', 'misconfigured')
);
alter table velo_proxy add constraint velo_proxy_hard_failures_valid check (hard_failures >= 0);
alter table velo_proxy add constraint velo_proxy_full_passes_valid check (full_passes >= 0);
alter table velo_proxy add constraint velo_proxy_error_code_safe check (
  last_error_code is null or last_error_code in ('connect_failed', 'dns_failed', 'connection_refused', 'timeout', 'certificate_invalid', 'hostname_mismatch', 'chain_invalid', 'bot_wall', 'login_required', 'route_forbidden', 'media_range_invalid', 'optional_stage_failed', 'credential_missing', 'credential_undecryptable', 'key_unstable', 'proxy_authentication_failed', 'invalid_configuration', 'forbidden_proxy_address', 'content_private', 'content_age_restricted', 'content_members_only', 'content_deleted', 'caller_abort')
);
create unique index velo_proxy_fingerprint_unique
  on velo_proxy (credential_fingerprint)
  where credential_fingerprint is not null;

create table velo_proxy_validation_run (
  id text primary key,
  status text not null default 'pending' check (status in ('pending', 'running', 'completed', 'partial', 'cancelled', 'failed')),
  route_ids text[] not null default '{}',
  next_cursor integer not null default 0 check (next_cursor >= 0),
  total_count integer not null default 0 check (total_count >= 0),
  completed_count integer not null default 0 check (completed_count >= 0),
  failed_count integer not null default 0 check (failed_count >= 0),
  lease_token text,
  lease_expires_at timestamptz,
  cancel_requested boolean not null default false,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  check (completed_count <= total_count),
  check (failed_count <= completed_count)
);

create table velo_proxy_validation_result (
  id text primary key,
  run_id text not null references velo_proxy_validation_run(id) on delete cascade,
  proxy_id text references velo_proxy(id) on delete set null,
  route_ref text not null check (route_ref ~ '^[0-9a-f]{64}$'),
  masked_label text not null check (masked_label ~ '^(HTTP|SOCKS5) [0-9a-f]{8} ••••:[0-9]{1,5}$'),
  verdict text not null check (verdict in ('unknown', 'checking', 'healthy', 'degraded', 'blocked', 'unreachable', 'unsafe_tls', 'misconfigured')),
  error_code text check (error_code is null or error_code in ('connect_failed', 'dns_failed', 'connection_refused', 'timeout', 'certificate_invalid', 'hostname_mismatch', 'chain_invalid', 'bot_wall', 'login_required', 'route_forbidden', 'media_range_invalid', 'optional_stage_failed', 'credential_missing', 'credential_undecryptable', 'key_unstable', 'proxy_authentication_failed', 'invalid_configuration', 'forbidden_proxy_address', 'content_private', 'content_age_restricted', 'content_members_only', 'content_deleted', 'caller_abort')),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  latency_ms integer check (latency_ms is null or latency_ms >= 0),
  unique (run_id, route_ref)
);

create table velo_proxy_validation_evidence (
  id text primary key,
  result_id text not null references velo_proxy_validation_result(id) on delete cascade,
  stage text not null check (stage in ('connection', 'tls', 'route_probe', 'metadata', 'media_range')),
  outcome text not null check (outcome in ('passed', 'failed', 'skipped')),
  code text check (code is null or code in ('connect_failed', 'dns_failed', 'connection_refused', 'timeout', 'certificate_invalid', 'hostname_mismatch', 'chain_invalid', 'bot_wall', 'login_required', 'route_forbidden', 'media_range_invalid', 'optional_stage_failed', 'credential_missing', 'credential_undecryptable', 'key_unstable', 'proxy_authentication_failed', 'invalid_configuration', 'forbidden_proxy_address', 'content_private', 'content_age_restricted', 'content_members_only', 'content_deleted', 'caller_abort')),
  http_status integer check (http_status is null or http_status between 100 and 599),
  duration_ms integer check (duration_ms is null or duration_ms >= 0),
  bytes_read integer check (bytes_read is null or bytes_read >= 0),
  created_at timestamptz not null default now(),
  unique (result_id, stage)
);

create table velo_proxy_event (
  id text primary key,
  proxy_id text references velo_proxy(id) on delete set null,
  route_ref text not null check (route_ref ~ '^[0-9a-f]{64}$'),
  masked_label text not null check (masked_label ~ '^(HTTP|SOCKS5) [0-9a-f]{8} ••••:[0-9]{1,5}$'),
  event_type text not null check (event_type in ('added', 'updated', 'enabled', 'disabled', 'reordered', 'validated', 'deleted')),
  verdict text check (verdict is null or verdict in ('unknown', 'checking', 'healthy', 'degraded', 'blocked', 'unreachable', 'unsafe_tls', 'misconfigured')),
  error_code text check (error_code is null or error_code in ('connect_failed', 'dns_failed', 'connection_refused', 'timeout', 'certificate_invalid', 'hostname_mismatch', 'chain_invalid', 'bot_wall', 'login_required', 'route_forbidden', 'media_range_invalid', 'optional_stage_failed', 'credential_missing', 'credential_undecryptable', 'key_unstable', 'proxy_authentication_failed', 'invalid_configuration', 'forbidden_proxy_address', 'content_private', 'content_age_restricted', 'content_members_only', 'content_deleted', 'caller_abort')),
  created_at timestamptz not null default now()
);

create index velo_proxy_validation_result_proxy_idx on velo_proxy_validation_result (proxy_id, completed_at desc);
create index velo_proxy_event_proxy_idx on velo_proxy_event (proxy_id, created_at desc);
