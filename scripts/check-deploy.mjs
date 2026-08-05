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
const EXPECTED_HEADING = '<h1>observatoire-web.fr</h1>';

/**
 * Paths that exist in the repository and must never be reachable over HTTP.
 * This is the assertion that encodes the original failure: it would have gone
 * red on every deploy in the broken window, while `/` alone would not have —
 * a site publishing the repo root 404s on `/` for want of an index.html, which
 * looks like a routing problem rather than the misconfiguration it was.
 */
const MUST_NOT_BE_SERVED = ['/package.json', '/CLAUDE.md', '/src/pages/index.astro'];

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

if (home.body.includes(EXPECTED_HEADING)) {
  pass('GET / renders the expected heading');
} else {
  fail(`GET / does not contain ${EXPECTED_HEADING}`);
}

for (const path of MUST_NOT_BE_SERVED) {
  const { status } = await request(path);
  if (status === 200) {
    fail(`${path} is served (status 200) — the repository is being published instead of the build`);
  } else {
    pass(`${path} is not served (status ${status})`);
  }
}

if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed against ${baseUrl}`);
  process.exit(1);
}

console.log('\nDeployment serves the application.');
