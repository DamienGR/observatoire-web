#!/usr/bin/env node
/**
 * Fails when `pnpm audit` reports an advisory nobody has accepted.
 *
 * The debt table asked for exactly this: "à revoir quand un `pnpm audit` propre
 * deviendra une exigence de CI plutôt qu'un contrôle manuel". A manual check is
 * a check that happens when someone remembers, and the 4 August entry saying
 * "0 high / 2 moderate" was still on the page on 18 August, when the real
 * figure was 4 high and 2 moderate. Nothing was lying; nobody had looked.
 *
 * The design is the one CLAUDE.md §10 uses for cache policies — a registry
 * rather than discipline — and it fails in both directions:
 *
 *  - an advisory that is not in ACCEPTED below fails the run;
 *  - an entry of ACCEPTED that no longer matches anything fails it too.
 *
 * The second half is the one that keeps this honest. An allowlist that only
 * ever grows silently becomes a list of things that used to be true, and the
 * day a package is patched nobody removes its exception — so the next
 * advisory on the same package is accepted by an argument written for a
 * different bug.
 *
 * NEVER on the path of a pull request. §5 forbids it in substance: a new
 * advisory is published by a third party, so this job goes red on a day nobody
 * touched the code, which is precisely the "fails for reasons foreign to the
 * diff" that teaches everyone to ignore a red CI. It runs weekly, like the
 * contract suite, plus on demand.
 *
 * Usage: node scripts/audit.mjs
 */
import { spawn } from 'node:child_process';

/**
 * Advisories we have looked at and decided to carry, each with the reason and
 * the condition for removing it.
 *
 * `reachable` is the field that matters and it is a measurement, not an
 * opinion: it says what was found in `.netlify/v1/`, the artefact Netlify
 * actually deploys, on 18 August 2026.
 */
const ACCEPTED = {
  'GHSA-w3rx-r6r6-pgpr': {
    module: 'image-size',
    severity: 'high',
    // No patched version exists: the advisory publishes `<0.0.0` as its fixed
    // range, so no bump and no override can reach a fix.
    reason:
      'ICNS parser infinite loop. Pulled by @netlify/dev-utils, the local dev ' +
      'server — absent from the deployed bundle (0 matches in .netlify/v1/). We never run ' +
      '`netlify dev`: there is no shell in production (§3).',
    review: 'Remove once image-size ships a fix and @netlify/dev-utils picks it up.',
  },
  'GHSA-5p2g-fcmc-qvqq': {
    module: 'image-size',
    severity: 'high',
    reason: 'JXL and HEIF parser infinite loops. Same package and same path as above.',
    review: 'Remove once image-size ships a fix and @netlify/dev-utils picks it up.',
  },
  'GHSA-jmr9-qjv8-65gv': {
    module: 'extract-zip',
    severity: 'high',
    reason:
      'Symlink path traversal when unzipping. Pulled by @netlify/functions-dev under ' +
      '@netlify/dev — local dev server only, 0 matches in the deployed bundle, and it ' +
      'only ever extracts archives Netlify built itself.',
    review: 'Remove once extract-zip ships a fix, or once @netlify/dev drops it.',
  },
};

/**
 * What Astro vendors is not what `pnpm audit` sees, and this is the finding
 * that made the exercise worth doing rather than a version bump.
 *
 * `astro/dist/assets/utils/vendor/image-size/` is a *copy* of image-size,
 * carrying `icns.js`, `jxl.js` and `heif.js` — the three parsers named by the
 * two advisories above — and it is in the deployed SSR bundle. No audit tool
 * can see it: it is not a package, it is source code inside another package.
 *
 * Its only entry point is `/_image`, a route Astro registers whether the site
 * uses images or not. That route answers 403 to any remote source, because
 * `image.domains` and `image.remotePatterns` are both empty, and this site
 * ships no local images either — so no attacker-controlled bytes reach a
 * parser today. `image.service: noop` was tried as a mitigation on 18 August
 * and measurably changes nothing: same routes, same vendored parsers, same
 * bundle size. It was reverted rather than kept as a reassuring no-op.
 *
 * This block is a comment and not code on purpose. There is nothing to assert
 * yet — only something the next session must not have to rediscover.
 */

const SEVERITIES = ['info', 'low', 'moderate', 'high', 'critical'];

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

const fail = (lines) => {
  process.stderr.write(`${lines.join('\n')}\n`);
  process.exit(1);
};

const { code, stdout, stderr } = await run('pnpm', ['audit', '--json']);

let report;
try {
  report = JSON.parse(stdout);
} catch {
  // An unparseable payload is the registry being unavailable, not a finding.
  // The contract suite makes the same distinction, and for the same reason:
  // reporting somebody else's bad minute as a vulnerability is how a red job
  // stops being believed.
  fail([
    `audit: pnpm audit did not return JSON (exit ${String(code)}).`,
    'This is an availability failure, not a security finding. Re-run before',
    'changing anything.',
    stderr.trim() || stdout.slice(0, 500),
  ]);
}

const advisories = Object.values(report.advisories ?? {});
const seen = new Set();
const unexpected = [];

for (const advisory of advisories) {
  const id = advisory.github_advisory_id;
  seen.add(id);
  const accepted = ACCEPTED[id];

  if (accepted === undefined) {
    unexpected.push(advisory);
    continue;
  }

  // An accepted entry still has to describe the advisory it accepts. A package
  // renamed or a severity raised means the argument was written about
  // something else.
  if (accepted.module !== advisory.module_name || accepted.severity !== advisory.severity) {
    unexpected.push(advisory);
  }
}

const stale = Object.entries(ACCEPTED).filter(([id]) => !seen.has(id));

const problems = [];

if (unexpected.length > 0) {
  problems.push(
    `${String(unexpected.length)} advisory/advisories are not accepted in scripts/audit.mjs:`,
    ...unexpected
      .sort((left, right) => SEVERITIES.indexOf(right.severity) - SEVERITIES.indexOf(left.severity))
      .map(
        (advisory) =>
          `  - [${advisory.severity}] ${advisory.module_name} ${advisory.vulnerable_versions} ` +
          `(${advisory.github_advisory_id})\n` +
          `    ${advisory.title}\n` +
          `    fixed in: ${advisory.patched_versions} — ${advisory.url}\n` +
          `    path: ${advisory.findings?.[0]?.paths?.[0] ?? 'unknown'}`,
      ),
    '',
    'Fix it — a version bump, or an override in pnpm-workspace.yaml with its',
    'reason — or accept it in ACCEPTED with what makes it unreachable here.',
    'Accepting is a decision that belongs in a pull request description, not',
    'in a passing build.',
  );
}

if (stale.length > 0) {
  problems.push(
    `${String(stale.length)} accepted advisory/advisories no longer appear in the audit:`,
    ...stale.map(([id, entry]) => `  - ${id} (${entry.module}) — ${entry.review}`),
    '',
    'Remove them from ACCEPTED. An exception nobody removes is an argument',
    'that outlives the bug it was written about, and it silently covers the',
    'next advisory on the same package.',
  );
}

if (problems.length > 0) fail(['audit: the dependency audit is not clean.', '', ...problems]);

process.stdout.write(
  `audit: clean — ${String(advisories.length)} advisory/advisories, all accepted with a reason ` +
    `(${Object.keys(ACCEPTED).join(', ')}).\n`,
);
