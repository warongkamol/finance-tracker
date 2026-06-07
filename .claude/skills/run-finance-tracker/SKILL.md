---
name: run-finance-tracker
description: >
  Launch and drive the Finance Tracker PWA to verify it works end-to-end —
  log in (or register a fixture account) and screenshot key pages.
  Use when asked to run, start, smoke-test, or verify this app in a browser.
  Trigger phrases: "run the project", "run the app", "verify the change works",
  "smoke test", "screenshot the dashboard/settings/transactions/etc".
---

# Run: Finance Tracker

A mobile-first Next.js PWA. "Running" it means a browser actually
rendering pages against a live Postgres-backed server — not `next build`,
not a unit test.

## 1. Make sure the stack is up

The app normally runs via Docker Compose (`db` = Postgres 16, `app` = the
Next.js production build), bound to `127.0.0.1:3000` / `127.0.0.1:5432`.

```bash
docker compose ps
# if not running:
docker compose up -d --build   # --build picks up any source changes
timeout 60 bash -c 'until curl -sf http://localhost:3000 >/dev/null; do sleep 1; done'
```

**Important:** `docker-compose.yml` builds an image from a `COPY . .` —
it does **not** bind-mount source. If you've edited files and want the
running container to reflect them, you must `--build` again (or run
`npm run dev` locally instead — `.env` already points `DATABASE_URL` at
`localhost:5432`, which the `db` container exposes).

## 2. Auth: a reusable fixture account

There's no seeded login (the seed user has `passwordHash: "not-a-real-hash"`).
Don't register a fresh random account every run — that litters the `users`
table. Instead, **try logging in with a fixed fixture account first; register
it only if login fails** (first run registers, every run after just logs in):

```js
const EMAIL = 'skill-runcheck@test.local';
const PASSWORD = 'SkillRunCheck123!';

async function login() {
  await page.goto(`${BASE}/login`);
  await page.fill('input[name="email"]', EMAIL);
  await page.fill('input[name="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(1500);
  return page.url().includes('/dashboard');
}

async function register() {
  await page.goto(`${BASE}/register`);
  await page.fill('input[name="name"]', 'Skill Run Check');
  await page.fill('input[name="email"]', EMAIL);
  await page.fill('input[name="password"]', PASSWORD);
  await page.fill('input[name="confirmPassword"]', PASSWORD);  // both required, or submit silently no-ops
  await page.click('button[type="submit"]');
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(1500);
  return page.url().includes('/dashboard');
}

if (!(await login())) await register();
```

Form fields **do** carry stable `name` attributes (`name`, `email`,
`password`, `confirmPassword`) from `react-hook-form` — use
`input[name="..."]`, not placeholder text (placeholders are Thai and
will break if copy changes).

## 3. Drive it

`chromium-cli` is not installed in this environment — use Playwright
directly (already a project dependency, `npx playwright` works). Full
driver: see [drive.mjs](drive.mjs) — it logs in/registers, then visits
and screenshots `/dashboard`, `/settings`, `/transactions`, `/debts`,
`/budget` and `/notifications`.

```bash
node "/Users/kwxnxxmbair/K Storage/Claude Workspace/finance-tracker/.claude/skills/run-finance-tracker/drive.mjs"
```

Screenshots land in `/tmp/run-check/*.png`. Always check the printed
`ERRORS` array (console + HTTP ≥400) before declaring success — a page
can render its shell while its data fetch fails silently.

## Known gotchas (won't show up as regressions)

- **`/forgot-password` 404** — the login page prefetches a link to a
  route that was never built. This always appears in `console --errors` /
  the response log; it's pre-existing, not something your change broke.
- **Bottom-nav layout** — pages render inside a mobile shell with a fixed
  bottom nav (~80px). `fullPage: true` screenshots still work, but
  elements near the bottom can be visually covered in the viewport-sized
  shot.
- **Thai locale** — all UI copy is Thai (`ภาษาไทย` per CLAUDE.md
  conventions). Match on stable attributes (`name`, `type`, `role`) or
  English route paths, not visible text, when writing selectors that
  must survive copy edits.
