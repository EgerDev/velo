-- Google (Better Auth's `google` provider, the project's own OAuth client) is
-- now the only sign-in method. Removed with it: the app-builder platform's
-- broker (providers `grok-google`, `grok-x`), its gate identity (`grok-gate`)
-- and email/password (`credential`).
--
-- No live account is migrated: broker and gate accounts only ever existed on
-- preview deployments, and password accounts were never email-verified. So:
--   - every session ends (the session cookie is also renamed to __Host-velo.*);
--   - pending verification rows (OAuth state, spent sign-in links) are dropped;
--   - accounts of the removed providers are deleted;
--   - users left without a sign-in method are deleted, with the YouTube cookie
--     jars stored under their ids (youtube_vault has no foreign key).
-- No table becomes unused: `verification` holds Google OAuth state.
delete from "session";
delete from "verification";
delete from "account" where "providerId" <> 'google';
delete from "user" u where not exists (select 1 from "account" a where a."userId" = u."id");
delete from youtube_vault v where not exists (select 1 from "user" u where u."id" = v.user_id);
