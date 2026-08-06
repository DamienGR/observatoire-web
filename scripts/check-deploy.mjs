#!/usr/bin/env node
/**
 * Asserts that a deployed site actually serves the application.
 *
 * This exists because of a real failure, not a hypothetical one. Netlify had no
 * build command and no publish directory, so it published the Git tree verbatim:
 * `/package.json` returned 200 with its real content while `/` returned 404.
 * Four pull requests were merged that day with a green `verify` and a
 * "Deploy Preview ready!" status, because nothing looked at what the deployment
 * *serves* (docs/journal.md 008).
 *
 * CLAUDE.md §1 is explicit that when CI is green and the product is broken, the
 * CI is what has to be fixed. This script is that fix.
 *
 * Usage: node scripts/check-deploy.mjs <base-url>
 */

/** Rendered by src/pages/index.astro. A 200 that serves the wrong thing is not a pass. */
const EXPECTED_HEADING = 'Qualité et accessibilité technique des sites des communes françaises';

/**
 * Paths that exist in the repository and must never be reachable over HTTP.
 * This is the assertion that encodes the original failure: it would have gone
 * red on every deploy in the broken window, while `/` alone would not have —
 * a site publishing the repo root 404s on `/` for want of an index.html, which
 * looks like a routing problem rather than the misconfiguration it was.
 */
const MUST_NOT_BE_SERVED = ['/package.json', '/CLAUDE.md', '/src/pages/index.astro'];

/**
 * Security headers CLAUDE.md §7 requires on every response, with what makes
 * each of them meaningful. They are built in src/lib/http/security.ts and unit
 * tested there; what this checks is that they survive the trip through Netlify
 * — a header the platform strips is a header the unit test still passes on.
 */
const REQUIRED_SECURITY_HEADERS = {
  'content-security-policy': /default-src 'self'/,
  'strict-transport-security': /max-age=\d+/,
  'x-content-type-options': /^nosniff$/,
  'referrer-policy': /strict-origin-when-cross-origin/,
  'permissions-policy': /geolocation=\(\)/,
};

/**
 * The budget for JavaScript sent to the browser, per page, as served.
 *
 * A site that publishes other sites' performance scores has to hold its own,
 * and the shell ships zero bytes of it today. The budget is not zero because
 * milestone 4 plans interactive rankings; it is low enough that an accident
 * fails loudly. The most likely accident is measured: enabling the Sentry
 * browser SDK costs 48 kB gzipped (measured 6/8/2026) to watch a page that runs
 * no JavaScript at all.
 *
 * Raising it is a decision to argue for in a pull request, not a number to
 * nudge.
 */
const CLIENT_JS_BUDGET_BYTES = 20 * 1024;

/**
 * Deliberately NOT asserted: that two requests render different timestamps.
 * It would prove the SSR function runs, but §10 plans long edge caching with
 * tag-based purging — the day that lands, a dynamism assertion turns red on
 * correct behaviour. A check that must be deleted to ship a planned feature is
 * a check people learn to ignore (§5).
 */

const REQUEST_TIMEOUT_MS = 15_000;
const ATTEMPTS = 6;
const RETRY_DELAY_MS = 10_000;
/** Enough for the shell and its foreseeable growth; a crawl, not a spider. */
const MAX_LINKED_PAGES = 20;

const baseUrl = process.argv[2]?.replace(/\/+$/, '');
if (!baseUrl) {
  console.error('usage: node scripts/check-deploy.mjs <base-url>');
  process.exit(2);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function request(path) {
  const response = await fetch(`${baseUrl}${path}`, {
    redirect: 'follow',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: { 'user-agent': 'observatoire-web-deploy-check' },
  });
  return { status: response.status, contentType: response.headers.get('content-type') ?? '' };
}

/**
 * The home page is fetched with retries: a fresh deploy can answer before its
 * function is warm. Everything after it runs once — by then the site is up, and
 * retrying an assertion that should already hold only hides flapping.
 */
async function fetchHomeWithRetry() {
  let last = { status: 0, headers: new Headers(), body: '', error: 'no response' };
  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/`, {
        redirect: 'follow',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        headers: { 'user-agent': 'observatoire-web-deploy-check' },
      });
      const body = await response.text();
      // Keep the real response even when it is a failure: reporting
      // "no response" for a site that answered 404 sends the next reader
      // hunting for a network fault that never happened.
      last = { status: response.status, headers: response.headers, body };
      if (response.ok) return last;
    } catch (error) {
      last = { status: 0, headers: new Headers(), body: '', error: error.message };
    }
    if (attempt < ATTEMPTS) {
      const reason = last.error ?? `HTTP ${last.status}`;
      console.log(`  attempt ${attempt}/${ATTEMPTS} failed (${reason}), retrying…`);
      await sleep(RETRY_DELAY_MS);
    }
  }
  return last;
}

/** Same-origin pages linked from a document, deduplicated, in order. */
function linkedPages(html) {
  const hrefs = [...html.matchAll(/<a\b[^>]*\bhref="([^"]+)"/gi)].map((match) => match[1]);
  const internal = hrefs
    .filter((href) => href.startsWith('/') && !href.startsWith('//'))
    .map((href) => href.split('#')[0])
    .filter((href) => href !== '' && href !== '/');

  return [...new Set(internal)].slice(0, MAX_LINKED_PAGES);
}

/**
 * Bytes a browser downloads for a script, as served.
 *
 * `content-length` is the transferred size, compressed when the CDN compressed
 * it — `fetch` decodes the body transparently, so the header is the only place
 * that number survives. It is reported as "as served" rather than "gzipped"
 * because whether it was compressed depends on the server answering, and a
 * check has no business asserting what it did not observe.
 */
async function transferSize(url) {
  const response = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: { 'user-agent': 'observatoire-web-deploy-check', 'accept-encoding': 'gzip, br' },
  });
  const declared = Number(response.headers.get('content-length'));
  const body = await response.arrayBuffer();

  return Number.isFinite(declared) && declared > 0 ? declared : body.byteLength;
}

const failures = [];
const pass = (message) => console.log(`  ok    ${message}`);
const fail = (message) => {
  console.log(`  FAIL  ${message}`);
  failures.push(message);
};

console.log(`Checking deployment at ${baseUrl}`);

const home = await fetchHomeWithRetry();

if (home.status === 200) {
  pass('GET / returns 200');
} else if (home.status > 0) {
  fail(`GET / returns HTTP ${home.status}, expected 200`);
} else {
  fail(`GET / got no response (${home.error})`);
}

const contentType = home.headers.get('content-type') ?? '';
if (contentType.includes('text/html')) {
  pass(`GET / is text/html`);
} else {
  fail(`GET / content-type is "${contentType || 'absent'}", expected text/html`);
}

const heading = /<h1\b[^>]*>([\s\S]*?)<\/h1>/.exec(home.body)?.[1]?.trim();
if (heading === EXPECTED_HEADING) {
  pass('GET / renders the expected heading');
} else {
  fail(`GET / heading is "${heading ?? 'absent'}", expected "${EXPECTED_HEADING}"`);
}

for (const path of MUST_NOT_BE_SERVED) {
  const { status } = await request(path);
  if (status === 200) {
    fail(`${path} is served (status 200) — the repository is being published instead of the build`);
  } else {
    pass(`${path} is not served (status ${status})`);
  }
}

// --- Security headers (CLAUDE.md §7) ----------------------------------------

for (const [name, expected] of Object.entries(REQUIRED_SECURITY_HEADERS)) {
  const value = home.headers.get(name);
  if (value === null) {
    fail(`${name} is absent from GET /`);
  } else if (!expected.test(value)) {
    fail(`${name} is "${value}", which does not match ${expected}`);
  } else {
    pass(`${name} is set`);
  }
}

const csp = home.headers.get('content-security-policy') ?? '';
for (const forbidden of ["'unsafe-inline'", "'unsafe-eval'"]) {
  if (csp.includes(forbidden)) {
    fail(`content-security-policy allows ${forbidden}, which §7 forbids`);
  } else {
    pass(`content-security-policy does not allow ${forbidden}`);
  }
}

/**
 * What the policy above costs, checked on the served HTML rather than assumed.
 * `script-src 'self'` and `style-src 'self'` without a hash or a nonce mean an
 * inline `<script>` or `<style>` is silently dropped by the browser — a failure
 * no build log and no HTTP status will ever show.
 *
 * This assertion holds for as long as the policy does. If a future feature
 * needs an inline script, the policy has to gain a hash or a nonce in the same
 * pull request, and this check is the reminder.
 */
const inlineScripts = [...home.body.matchAll(/<script\b(?![^>]*\bsrc=)[^>]*>/gi)];
if (inlineScripts.length === 0) {
  pass("GET / carries no inline <script>, as script-src 'self' requires");
} else {
  fail(`GET / carries ${inlineScripts.length} inline <script>, blocked by script-src 'self'`);
}

const inlineStyles = [...home.body.matchAll(/<style\b[^>]*>/gi)];
if (inlineStyles.length === 0) {
  pass("GET / carries no inline <style>, as style-src 'self' requires");
} else {
  fail(`GET / carries ${inlineStyles.length} inline <style>, blocked by style-src 'self'`);
}

// --- Every page linked from the home page answers ---------------------------

/**
 * The list is read from the page rather than written here: a shell page added
 * without a link from anywhere is not reachable, and one added with a link is
 * checked without anyone having to remember this file.
 */
for (const path of linkedPages(home.body)) {
  const { status, contentType: type } = await request(path);
  if (status === 200 && type.includes('text/html')) {
    pass(`GET ${path} returns 200 text/html`);
  } else {
    fail(
      `GET ${path} returns HTTP ${status} (${type || 'no content-type'}), expected 200 text/html`,
    );
  }
}

const missing = await request('/cette-page-nexiste-pas-observatoire-web');
if (missing.status === 404) {
  pass('GET an unknown path returns 404');
} else {
  fail(`GET an unknown path returns HTTP ${missing.status}, expected 404`);
}

// --- Client JavaScript budget -----------------------------------------------

const scriptUrls = [...home.body.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/gi)].map(
  (match) => new URL(match[1], `${baseUrl}/`).href,
);

let totalBytes = 0;
for (const url of scriptUrls) {
  totalBytes += await transferSize(url);
}

const kib = (bytes) => `${(bytes / 1024).toFixed(1)} kB`;

if (totalBytes <= CLIENT_JS_BUDGET_BYTES) {
  pass(
    `GET / ships ${kib(totalBytes)} of JavaScript as served in ${scriptUrls.length} file(s), ` +
      `budget ${kib(CLIENT_JS_BUDGET_BYTES)}`,
  );
} else {
  fail(
    `GET / ships ${kib(totalBytes)} of JavaScript as served, over the ${kib(CLIENT_JS_BUDGET_BYTES)} budget. ` +
      'If this is the Sentry browser SDK, it is enabled by PUBLIC_SENTRY_DSN and costs ' +
      '48 kB gzipped to watch a site that runs no client JavaScript.',
  );
}

if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed against ${baseUrl}`);
  process.exit(1);
}

console.log('\nDeployment serves the application.');
