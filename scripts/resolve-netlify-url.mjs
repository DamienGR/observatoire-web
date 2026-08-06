#!/usr/bin/env node
/**
 * Waits for Netlify's commit status and writes its target URL to the job output.
 *
 * The URL is discovered rather than configured. CLAUDE.md §6 forbids a base URL
 * in the diff, and a hardcoded host would be wrong on every branch but one:
 * a pull request gets `deploy-preview-<n>--<site>`, a push to main gets the
 * production host. Netlify publishes both as a commit status, so the status is
 * the source of truth.
 *
 * Reads GH_TOKEN, SHA and REPO from the environment. The token needs
 * `statuses: read` and nothing else — no Netlify credential is involved, which
 * is why this job is safe to run on a pull request (§7).
 */

const token = process.env.GH_TOKEN;
const sha = process.env.SHA;
const repo = process.env.REPO;

if (!token || !sha || !repo) {
  console.error('resolve-netlify-url: GH_TOKEN, SHA and REPO are all required');
  process.exit(2);
}

const ATTEMPTS = 30;
const DELAY_MS = 10_000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function statuses() {
  const response = await fetch(`https://api.github.com/repos/${repo}/statuses/${sha}`, {
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/vnd.github+json',
      'user-agent': 'observatoire-web-ci',
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new Error(`GitHub API returned ${response.status}`);
  }
  return response.json();
}

/**
 * Netlify reports failures as `error` or `failure`. Treating those as
 * "not ready yet" would spend the whole timeout waiting for a deploy that has
 * already given up, and then report a timeout instead of the real cause.
 */
function classify(all) {
  const netlify = all.filter((status) => status.context?.startsWith('netlify/'));
  const ready = netlify.find((status) => status.state === 'success' && status.target_url);
  if (ready) return { kind: 'ready', url: ready.target_url, context: ready.context };

  const broken = netlify.find((status) => status.state === 'error' || status.state === 'failure');
  if (broken) return { kind: 'failed', context: broken.context, description: broken.description };

  return { kind: 'pending', seen: netlify.length };
}

for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
  let result;
  try {
    result = classify(await statuses());
  } catch (error) {
    console.log(`attempt ${attempt}/${ATTEMPTS}: ${error.message}`);
    await sleep(DELAY_MS);
    continue;
  }

  if (result.kind === 'ready') {
    console.log(`${result.context} -> ${result.url}`);
    // GITHUB_OUTPUT only exists inside Actions. Outside it, print and succeed
    // rather than crash, so the script stays runnable by hand when diagnosing.
    if (process.env.GITHUB_OUTPUT) {
      const { appendFileSync } = await import('node:fs');
      appendFileSync(process.env.GITHUB_OUTPUT, `url=${result.url}\n`);
    }
    process.exit(0);
  }

  if (result.kind === 'failed') {
    console.error(
      `Netlify deploy failed: ${result.context} — ${result.description ?? 'no detail'}`,
    );
    process.exit(1);
  }

  console.log(
    `attempt ${attempt}/${ATTEMPTS}: no successful netlify/* status yet ` +
      `(${result.seen} netlify status(es) seen)`,
  );
  if (attempt < ATTEMPTS) await sleep(DELAY_MS);
}

console.error(
  `No successful netlify/* commit status on ${sha} after ${(ATTEMPTS * DELAY_MS) / 1000}s.\n` +
    'Either the site is not linked to this repository, or the deploy never started.',
);
process.exit(1);
