# Deployment Runbook

Production = Vercel Hobby (web + cron + coach endpoint) + Neon free Postgres
+ brain runs on Marcus's Mac via launchd. Hard cost cap: ≤$35/60 days
(design target: $20 prepaid API credits are the only possible spend).

## Local dev

```bash
docker compose up -d          # Postgres :5433, Redis :6380
pnpm db:migrate && pnpm db:seed
pnpm typecheck && pnpm test
```

## Mac brain-run schedule (launchd)

Runs 3–4×/day. Template — save as
`~/Library/LaunchAgents/com.bivines.cai.brainrun.plist`, then
`launchctl load` it. Requires System Settings → "Wake for network access /
scheduled tasks" enabled.

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.bivines.cai.brainrun</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/zsh</string><string>-lc</string>
    <string>cd "$HOME/Documents/Biv Career Coach/cai-career-agent" &amp;&amp; pnpm --filter worker brain >> ~/Library/Logs/cai-brainrun.log 2>&amp;1</string>
  </array>
  <key>StartCalendarInterval</key>
  <array>
    <dict><key>Hour</key><integer>7</integer><key>Minute</key><integer>30</integer></dict>
    <dict><key>Hour</key><integer>12</integer><key>Minute</key><integer>0</integer></dict>
    <dict><key>Hour</key><integer>17</integer><key>Minute</key><integer>0</integer></dict>
    <dict><key>Hour</key><integer>21</integer><key>Minute</key><integer>0</integer></dict>
  </array>
</dict></plist>
```

The run reads `DATABASE_URL` from the repo `.env` (local dev DB now; Neon
connection string at deploy time). `AGENT_RUNNER=claude-code` — subscription-
covered, $0.

## Deploy time (end of Stage 2)

1. Neon: create free project → copy connection string → `pnpm db:migrate`
   against it → set as `DATABASE_URL` in `.env` (Mac) and Vercel env.
2. Vercel: import repo, root directory `apps/web`, Hobby plan. Env vars:
   `DATABASE_URL` (Neon), `ANTHROPIC_API_KEY` (the $20-capped key, coach
   fallback only), later `GMAIL_*` + `TELEGRAM_BOT_TOKEN`.
3. Domain: add `cai.bivinesgroup.com` in Vercel → add the CNAME it gives you
   at the DNS provider.
4. Vercel cron (vercel.json): Gmail poll ~15 min, notification dispatch,
   follow-up scheduler.
5. Auth: Auth.js magic-link, allowlist = family emails only.
6. Backups: Neon has PITR built in; weekly `pg_dump` to local disk from
   the Mac (cron in the launchd plist above or a second entry).

## Coach relay (Stage 4)

Vercel coach endpoint tries the Mac listener first (Tailscale/urled tunnel or
polling handshake — decided in Stage 4), falls back to `AGENT_RUNNER=api`
under the prepaid cap. If credits are exhausted the endpoint queues the
message for the next brain run and tells Cai when to expect the reply.

## Escape hatch (only if free tiers or Mac scheduling fall short)

Same Docker Compose on a ~$15/mo VPS behind Cloudflare Tunnel + Access;
`AGENT_RUNNER=api` there ≈ $25–50/60 days at batch cadence. Config change,
not a rewrite.
