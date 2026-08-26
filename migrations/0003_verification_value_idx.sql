-- Sign-in links are found and spent by their hashed `value`, never by
-- `identifier`, so the existing identifier index never covered that path:
-- every redemption sequentially scanned `verification`, and the table only
-- grows as unused link requests expire in place.
--
-- The index also lands in 0001_auth.sql for fresh installs; this migration
-- carries it to databases that already applied that file. Guarded because the
-- auth schema is opt-in — an app that never turned sign-in on has no
-- `verification` table, and an unguarded CREATE INDEX would break its chain.
do $$
begin
  if to_regclass('public.verification') is not null then
    create index if not exists "verification_value_idx" on "verification" ("value");
  end if;
end $$;
