import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * The frozen PageSpeed Insights captures (tests/fixtures/README.md).
 *
 * Reading them is filesystem access, which the unit project allows — the
 * anti-I/O guard covers the network (tests/setup/no-io.ts). Nothing in a unit
 * test can call PSI, which is the whole reason these files exist.
 *
 * Outside `src/` on purpose: everything under `src/lib/` is measured for
 * coverage and mutated by Stryker, and a fixture reader is neither business
 * logic nor something a mutant could teach us anything about.
 */
export function readPsiFixture(name: string): unknown {
  const path = fileURLToPath(new URL(`../../fixtures/psi/${name}`, import.meta.url));
  return JSON.parse(readFileSync(path, 'utf8')) as unknown;
}

/** Paris, mobile, 23 August 2026: HTTP 200, three accessibility failures. */
export const PARIS = 'paris.mobile.json';
/** Andrézieux-Bouthéon, the small end of the perimeter: seven failures. */
export const ANDREZIEUX = 'andrezieux-boutheon.mobile.json';
/** A page that does not exist on a site that works: PSI measures the 404. */
export const PAGE_ABSENTE = 'paris-page-absente.mobile.json';
/** HTTP 400, `FAILED_DOCUMENT_REQUEST`, `net::ERR_FAILED` — a 503 behind a CDN. */
export const DOCUMENT_INDISPONIBLE = 'erreur-document-indisponible.json';
/** HTTP 400, same code, `net::ERR_CONNECTION_FAILED` — the host no longer resolves. */
export const HOTE_INJOIGNABLE = 'erreur-hote-injoignable.json';
