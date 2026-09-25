# Notes for coding agents

Velo is a TanStack Start app (React 19, Vite, Nitro `node-server`) with Better
Auth (Google sign-in) on PostgreSQL. It is being hardened for an open-source
release. The plan of record is
[`docs/superpowers/plans/2026-09-23-00-roadmap.md`](docs/superpowers/plans/2026-09-23-00-roadmap.md):
read its Global Constraints and Shared Contract before changing code. Where this
file and the roadmap disagree, the roadmap wins.

## How work is done

- Every change follows a task in a plan under `docs/superpowers/plans/`: one
  task, one Conventional Commit, and a regression test written first and seen
  failing.
- Gates before a commit: `npm run typecheck && npm run lint && npm test`. After
  a server change, also `npm run build && npm run test:http`.
- `npm run dev` serves `http://localhost:8080` on loopback (`VELO_DEV_HOST` and
  `VELO_DEV_PORT` override it). Sign-in needs `GOOGLE_CLIENT_ID` and
  `GOOGLE_CLIENT_SECRET`; without them it is unavailable and per-user features
  answer 401. Open `http://localhost:<port>`, not `127.0.0.1`: the OAuth state
  cookie is host-bound, so a sign-in started on `127.0.0.1` fails.
- `npm start` runs the production build and refuses to boot without
  `DATABASE_URL`, `BETTER_AUTH_SECRET` (at least 32 characters),
  `VELO_PUBLIC_ORIGIN`, `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`
  (`src/lib/env.server.ts`).
- `npm run preview` and `npm run build:dev` go through Nitro too, so their
  server forces production and needs the same five variables. There is no
  dev-defaults preview.

## Invariants

- New server code reads configuration through `serverEnv()`; older modules
  still read `process.env` directly until W3/W4a/W5. Server code logs only
  through `log` (`src/lib/log.server.ts`). Never log or return cookies, tokens
  or raw error messages.
- Every server function that touches per-user data uses `authMiddleware` and
  scopes its queries by `context.userId`. There is no shared or fallback user.
- Migrations in `migrations/` are forward-only: never edit an applied file, add
  the next numbered one.
- The server must not execute third-party JavaScript (no `eval`, `new Function`
  or `vm`); W4b removes the remaining uses.
- Changes to auth, cookies, subprocesses, headers or crypto get an independent
  review before merge.
