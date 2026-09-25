# Systemd Template Notes

Goal: keep `hermes-dashboard` "plug-and-play" across OpenClaw instances by avoiding:

- hardcoded home directories (`/home/<user>/...`)
- secrets inside unit files

## Recommended Layout

- App code: `/opt/hermes-dashboard`
- Runtime data:
  - DB: `/var/lib/hermes-dashboard/hermes.db`
  - State: `/var/lib/hermes-dashboard/state/`
- Env file (secrets + config): `/etc/hermes-dashboard/hermes-dashboard.env`

## Unit File

Use `ops/systemd/hermes-dashboard.service` as a starting point.

Important: update these to match your deployment:

- `WorkingDirectory=...`
- `EnvironmentFile=...`
- `ReadWritePaths=...` (must cover your DB and state dirs)
- `User=` / `Group=`

## Env File

Minimal required values:

- `AUTH_USER`, `AUTH_PASS`
- `API_KEY`

Template-safe defaults:

- `HERMES_DB_PATH=/var/lib/hermes-dashboard/hermes.db`
- `HERMES_STATE_DIR=/var/lib/hermes-dashboard/state`

Network binding (`#100`):

- `HERMES_HOST_LOCK` is a best-effort `Host`-header check, not a network
  boundary — a remote peer can send `Host: localhost`. The real boundary is
  the listen address plus firewall rules.
- Local-only posture: `HOSTNAME=127.0.0.1` (+ `PORT=3000`, or your chosen
  port). The standalone server defaults to `0.0.0.0` when `HOSTNAME` is unset.
- Tailscale-serve posture: keep the default bind, restrict at the tailnet /
  firewall layer, and leave `HERMES_HOST_LOCK=local` (it allows `100.*` and
  `*.ts.net`).

OpenClaw instance discovery:

- Single instance:
  - `HERMES_OPENCLAW_HOME=/home/<user>/.openclaw`
  - `HERMES_DEFAULT_INSTANCE=default`
- Multi instance:
  - `HERMES_OPENCLAW_INSTANCES=[{"id":"default","label":"Default","openclawHome":"..."}]`

## Secrets Hygiene

If you currently have a systemd drop-in (e.g. `override.conf`) that sets secrets via `Environment=...`,
move those values into the env file and remove them from the drop-in.


## Build Notes

Use `pnpm build:standalone` for deployments that run `.next/standalone/server.js`, so `/_next/static/*` assets are copied into the standalone bundle.

## 1Password (Recommended)

If you deploy with 1Password, the standalone entrypoint supports resolving secrets at runtime via op run.

- Non-secret config: /etc/hermes-dashboard/hermes-dashboard.env
- op:// references (non-secret template): /etc/hermes-dashboard/hermes-dashboard.op.env
- Required secret for op: OP_SERVICE_ACCOUNT_TOKEN (set via systemd EnvironmentFile or another secret store)
- Optional mode flag:
  - `HERMES_1PASSWORD_MODE=off` (never use op)
  - `HERMES_1PASSWORD_MODE=auto` (default; try op then fallback to env)
  - `HERMES_1PASSWORD_MODE=required` (fail startup if op cannot run)

A template for the op env file lives at: ops/1password/hermes-dashboard.op.env.example

Notes:
- Analytics keys like PLAUSIBLE_SITE_ID / PLAUSIBLE_API_KEY should live in 1Password and be referenced from the op env template.
- scripts/start-standalone.sh uses op run according to `HERMES_1PASSWORD_MODE` and `HERMES_OP_ENV_FILE`.
