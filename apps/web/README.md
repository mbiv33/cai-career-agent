# apps/web — Stage 1 (Track B)

Mobile-first PWA dashboard (Next.js + Tailwind): Home | Needs You | Activity |
Pipeline | Career, plus the coach chat and the Vercel cron endpoints
(Gmail poll, notifications) and the coach relay/fallback endpoint.
Scaffold with `pnpm create next-app` in this directory (TypeScript, App
Router, Tailwind), then build screens against `@cai/db` reads only —
writes go through `@cai/core`.
