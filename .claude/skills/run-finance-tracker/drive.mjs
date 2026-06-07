// Smoke-drive the Finance Tracker app: log in (or register a fixture
// account on first run), then visit and screenshot the main pages.
// Usage: node drive.mjs
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const EMAIL = 'skill-runcheck@test.local';
const PASSWORD = 'SkillRunCheck123!';
const OUT_DIR = '/tmp/run-check';

mkdirSync(OUT_DIR, { recursive: true });

const browser = await chromium.launch({ args: ['--no-sandbox'] });
const page = await (await browser.newContext()).newPage();

const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('response', (r) => {
  if (r.status() >= 400 && !r.url().includes('favicon')) {
    errors.push(`HTTP ${r.status()} ${r.url()}`);
  }
});

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
  await page.fill('input[name="confirmPassword"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(1500);
  return page.url().includes('/dashboard');
}

let authed = await login();
if (!authed) {
  console.log('No fixture account yet — registering one…');
  authed = await register();
}
if (!authed) {
  console.error('FAILED to authenticate. URL:', page.url());
  await page.screenshot({ path: `${OUT_DIR}/auth-failure.png`, fullPage: true });
  await browser.close();
  process.exit(1);
}
console.log('Authenticated as', EMAIL);

const pages = ['dashboard', 'transactions', 'debts', 'budget', 'notifications', 'settings'];
for (const route of pages) {
  await page.goto(`${BASE}/${route}`);
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `${OUT_DIR}/${route}.png`, fullPage: true });
  console.log(`✓ ${route} -> ${page.url()}`);
}

console.log('ERRORS (expect only the known /forgot-password 404):');
console.log(JSON.stringify(errors, null, 2));

await browser.close();
