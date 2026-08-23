#!/usr/bin/env node
/**
 * Turns a raw PageSpeed Insights capture into the fixture that is committed.
 *
 * The capture is 600 kB to 1.2 MB of JSON per page, three quarters of which is
 * a full-page screenshot in base64. Committing that would be absurd, and
 * CLAUDE.md §11.1 already says what this project thinks of keeping raw
 * Lighthouse reports. But tests/fixtures/README.md is equally clear that a
 * fixture is a *verbatim capture* nobody edits by hand — so the reduction has
 * to be mechanical, reviewable and repeatable, which is what this script is.
 *
 * What it keeps is stated as a list rather than as a filter over "what the
 * parser reads": a fixture pruned by the parser's own opinion could never
 * contradict it. The accessibility category is kept **whole** — all 76 audits,
 * passing ones included — precisely so that a test can prove the extraction
 * ignores the ones it should ignore.
 *
 * Usage:
 *   node scripts/prune-psi-capture.mjs <capture.json> <fixture.json>
 *
 * The capture itself comes from a manual dispatch of the Contracts workflow,
 * which is the only way any of this can be observed at all: no session can call
 * PSI (docs/journal.md 027 and 032).
 */
import { readFileSync, writeFileSync } from 'node:fs';

/** The six audits `measurement` has a metric column for. */
const METRIC_AUDITS = [
  'largest-contentful-paint',
  'first-contentful-paint',
  'speed-index',
  'total-blocking-time',
  'interactive',
  'cumulative-layout-shift',
];

/** Read for the status of the main document, and to prove the 404 case. */
const DIAGNOSTIC_AUDITS = ['network-requests', 'http-status-code'];

const [, , source, destination] = process.argv;

if (source === undefined || destination === undefined) {
  console.error('Usage: node scripts/prune-psi-capture.mjs <capture.json> <fixture.json>');
  process.exit(2);
}

const capture = JSON.parse(readFileSync(source, 'utf8'));

/** An error payload is small and is kept exactly as it arrived. */
if (capture.lighthouseResult === undefined) {
  writeFileSync(destination, `${JSON.stringify(capture, null, 2)}\n`, 'utf8');
  console.info(`${destination}: error payload kept verbatim`);
  process.exit(0);
}

const lhr = capture.lighthouseResult;
const accessibilityAudits = lhr.categories.accessibility.auditRefs.map((ref) => ref.id);

const audits = {};
for (const id of [...METRIC_AUDITS, ...DIAGNOSTIC_AUDITS, ...accessibilityAudits]) {
  if (lhr.audits[id] !== undefined) audits[id] = lhr.audits[id];
}

/**
 * `network-requests` lists every request of the page — 42 for Paris, 111 for
 * Andrézieux-Bouthéon — and only the document ones say what the URL answered.
 * This is the one place the reduction touches *inside* an audit, and it is
 * recorded in tests/fixtures/README.md as such.
 */
const networkRequests = audits['network-requests'];
if (networkRequests?.details?.items !== undefined) {
  audits['network-requests'] = {
    ...networkRequests,
    details: {
      ...networkRequests.details,
      items: networkRequests.details.items.filter((item) => item.resourceType === 'Document'),
    },
  };
}

const fixture = {
  captchaResult: capture.captchaResult,
  kind: capture.kind,
  id: capture.id,
  analysisUTCTimestamp: capture.analysisUTCTimestamp,
  lighthouseResult: {
    requestedUrl: lhr.requestedUrl,
    mainDocumentUrl: lhr.mainDocumentUrl,
    finalDisplayedUrl: lhr.finalDisplayedUrl,
    lighthouseVersion: lhr.lighthouseVersion,
    fetchTime: lhr.fetchTime,
    runWarnings: lhr.runWarnings,
    ...(lhr.runtimeError === undefined ? {} : { runtimeError: lhr.runtimeError }),
    // 337 bytes, and it names the axe-core version that produced the findings.
    environment: lhr.environment,
    configSettings: lhr.configSettings,
    categories: lhr.categories,
    audits,
  },
};

const written = `${JSON.stringify(fixture, null, 2)}\n`;
writeFileSync(destination, written, 'utf8');

console.info(
  `${destination}: ${String(Math.round(readFileSync(source, 'utf8').length / 1024))} kB captured, ` +
    `${String(Math.round(written.length / 1024))} kB kept, ` +
    `${String(Object.keys(audits).length)} audits of ${String(Object.keys(lhr.audits).length)}`,
);
