#!/usr/bin/env node
/**
 * Runs Lighthouse against a deployment and holds it to a budget.
 *
 * The brief asks for this twice, and calls it "exigence non négociable pour un
 * site qui publie le score des autres" (docs/brief.md §5 and §12). Until now
 * CLAUDE.md §6.4 made "budget Lighthouse tenu" a condition of merge while no
 * Lighthouse existed anywhere in the repository — a box ticked out of habit,
 * which §5 says is how a CI stops being read.
 *
 * What it does NOT assert, and why:
 *
 *  - **Accessibility.** axe-core already runs on every page in both palettes,
 *    with no tag filter (tests/e2e/accessibility.spec.ts). Lighthouse's audit
 *    is a subset of it; asserting it again would add a second source of
 *    flakiness and no coverage.
 *  - **SEO.** Every page carries `noindex` on purpose while the observatory
 *    publishes no measurement (docs/roadmap.md). Lighthouse scores that as a
 *    failure, correctly, and the deliberate choice would fail the build.
 *
 * What is left is the subject the brief actually names: weight and speed. The
 * metric budgets below matter more than the category score — a score is a
 * weighted average that can hide a regression in one metric behind an
 * improvement in another.
 *
 * Usage: node scripts/lighthouse-budget.mjs <base-url> [path...]
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import lighthouse from 'lighthouse';
import { chromium } from '@playwright/test';

/**
 * One page per template, not one per page: §5's rule for the E2E layer applies
 * here for the same reason, and more sharply — a Lighthouse run costs about
 * twenty seconds where a page visit costs one.
 *
 * `/` is the shell every editorial page shares. `/stats` is the only page that
 * reads the database, so the only one whose server response time is its own,
 * and the one milestone 4 will make heavy.
 */
const DEFAULT_PATHS = ['/', '/stats'];

/**
 * Provisional, and marked as such rather than quietly precise.
 *
 * No session can measure them: `pnpm preview` does not work under the Netlify
 * adapter, and Chromium in a session container cannot reach a public URL
 * (docs/journal.md 020 and 025). The instrument is CI, so these start as
 * regression alarms — loose enough that today's site passes with room, tight
 * enough that an unoptimised image or a blocking font fails loudly — and are
 * tightened against the first real run.
 *
 * Raising one is a decision to argue for in a pull request, not a number to
 * nudge. Same rule as the JavaScript budget in check-deploy.mjs.
 */
const BUDGET = {
  performance: 0.9,
  'best-practices': 0.9,
  metrics: {
    'largest-contentful-paint': { max: 2500, unit: 'ms' },
    'total-blocking-time': { max: 200, unit: 'ms' },
    'cumulative-layout-shift': { max: 0.1, unit: '' },
    'speed-index': { max: 3400, unit: 'ms' },
  },
  /** Everything the page pulls, as Lighthouse counts it. */
  totalByteWeight: { max: 300 * 1024, unit: 'B' },
};

const [, , baseUrl, ...pathArguments] = process.argv;

if (baseUrl === undefined || baseUrl === '') {
  console.error('usage: node scripts/lighthouse-budget.mjs <base-url> [path...]');
  process.exit(2);
}

const paths = pathArguments.length > 0 ? pathArguments : DEFAULT_PATHS;
const failures = [];
const report = [];

const pass = (message) => console.log(`  ok    ${message}`);
const fail = (message) => {
  console.log(`  FAIL  ${message}`);
  failures.push(message);
};

/**
 * Lighthouse wants a port; Playwright already ships the browser CI installs.
 *
 * `CHROME_PATH` is Lighthouse's own convention, honoured here for the reason
 * docs/roadmap.md records: the session container carries Chromium 1194 while
 * @playwright/test pins 1234, and `playwright install` is discouraged in this
 * environment. CI installs the pinned revision and sets nothing, so the browser
 * stays versioned with the suite where it counts.
 */
const executablePath = process.env.CHROME_PATH;

const browser = await chromium.launch({
  args: ['--remote-debugging-port=9222'],
  ...(executablePath === undefined || executablePath === '' ? {} : { executablePath }),
});

/**
 * `desktop` rather than the mobile default: the throttling profile has to be
 * the one the numbers were set against, and a default that changes between
 * Lighthouse majors is a budget that moves without a pull request.
 */
const options = {
  port: 9222,
  output: 'json',
  logLevel: 'error',
  screenEmulation: {
    mobile: false,
    width: 1350,
    height: 940,
    deviceScaleFactor: 1,
    disabled: false,
  },
  formFactor: 'desktop',
  throttling: {
    rttMs: 40,
    throughputKbps: 10 * 1024,
    cpuSlowdownMultiplier: 1,
    requestLatencyMs: 0,
    downloadThroughputKbps: 0,
    uploadThroughputKbps: 0,
  },
  onlyCategories: ['performance', 'best-practices'],
};

try {
  for (const path of paths) {
    const url = new URL(path, baseUrl).href;
    console.log(`\n${url}`);

    const run = await lighthouse(url, options);

    if (run === undefined || run.lhr === undefined) {
      fail(`${path}: Lighthouse returned no result`);
      continue;
    }

    const { lhr } = run;

    if (lhr.runtimeError !== undefined && lhr.runtimeError.code !== 'NO_ERROR') {
      // A page Lighthouse could not load is not a page that passed.
      fail(`${path}: ${lhr.runtimeError.code} — ${lhr.runtimeError.message}`);
      continue;
    }

    const scores = {};

    for (const [category, minimum] of Object.entries(BUDGET)) {
      if (typeof minimum !== 'number') continue;

      const score = lhr.categories[category]?.score;
      scores[category] = score;

      if (score === undefined || score === null) {
        fail(`${path}: ${category} was not scored`);
      } else if (score < minimum) {
        fail(`${path}: ${category} ${score.toFixed(2)}, budget ${String(minimum)}`);
      } else {
        pass(`${category} ${score.toFixed(2)} (budget ${String(minimum)})`);
      }
    }

    const metrics = {};

    for (const [id, { max, unit }] of Object.entries(BUDGET.metrics)) {
      const value = lhr.audits[id]?.numericValue;
      metrics[id] = value;

      if (typeof value !== 'number') {
        fail(`${path}: ${id} was not measured`);
      } else if (value > max) {
        fail(`${path}: ${id} ${value.toFixed(0)}${unit}, budget ${String(max)}${unit}`);
      } else {
        pass(`${id} ${value.toFixed(0)}${unit} (budget ${String(max)}${unit})`);
      }
    }

    const weight = lhr.audits['total-byte-weight']?.numericValue;

    if (typeof weight !== 'number') {
      fail(`${path}: total byte weight was not measured`);
    } else if (weight > BUDGET.totalByteWeight.max) {
      fail(
        `${path}: total byte weight ${(weight / 1024).toFixed(1)} kB, ` +
          `budget ${String(BUDGET.totalByteWeight.max / 1024)} kB`,
      );
    } else {
      pass(`total byte weight ${(weight / 1024).toFixed(1)} kB`);
    }

    report.push({ path, url, scores, metrics, totalByteWeight: weight });
  }
} finally {
  await browser.close();
}

// The numbers, whatever the verdict: from a cloud-only session an artefact is
// the only way to read them, and this is the run the budgets are set against
// (CLAUDE.md §1).
const reportPath = 'reports/lighthouse/summary.json';
mkdirSync(dirname(reportPath), { recursive: true });
writeFileSync(
  reportPath,
  `${JSON.stringify({ baseUrl, budget: BUDGET, report }, null, 2)}\n`,
  'utf8',
);
console.log(`\nreport written to ${reportPath}`);

if (failures.length > 0) {
  console.error(`\n${String(failures.length)} budget failure(s).`);
  process.exit(1);
}

console.log(`\nAll budgets held across ${String(paths.length)} page(s).`);
