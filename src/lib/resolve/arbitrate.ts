import { rankCandidates } from './attempt.js';
import type { ResolutionReason, StatutResolution } from './states.js';
import { isSameHost } from './verdict.js';

/**
 * What to do with the *other* candidates of a commune.
 *
 * This is the file the brief points at when it says resolution is a process
 * rather than a column (docs/brief.md §4): 138 communes of the perimeter carry
 * several candidate URLs, most often a homepage and a "mes démarches" page. One
 * commune gets one score, so one of them has to win — and the losers have to
 * leave a trace, which is the whole reason `site` is a table.
 *
 * Nothing here fetches, and nothing here overrides an observation: arbitration
 * reads the states the observations produced and proposes moves a scan is
 * allowed to make.
 */

export interface CandidateState {
  /** The URL as stored on the `site` row. */
  readonly url: string;
  readonly statut: StatutResolution;
  /** Where it answered, when it did — the redirect chain's last URL. */
  readonly resolvedUrl: string | null;
}

export interface Disposition {
  readonly url: string;
  readonly to: StatutResolution;
  readonly reason: ResolutionReason;
}

export interface Arbitration {
  /** The URL the scanner should measure for this commune, if one is settled. */
  readonly elected: string | null;
  /** Moves to apply, in the order the candidates were given. */
  readonly dispositions: readonly Disposition[];
}

/** Where a candidate ended up, which is what "the same site" is judged on. */
function effectiveUrl(candidate: CandidateState): string {
  return candidate.resolvedUrl ?? candidate.url;
}

/**
 * Arbitrates one commune's candidates.
 *
 * The election is `rankCandidates` applied to the URLs that answered: homepage
 * before deep link, https before http, directory order to break ties. Ranking
 * decides only *between verified URLs* — never which one is right in the
 * absence of evidence, which is why a commune with no verified candidate elects
 * nothing rather than its best-looking string.
 *
 * The dispositions follow one distinction:
 *
 *  - **Same site as the elected one** — an alias or a section of it. Closed as
 *    `invalide`, with the reason saying so. Two rows measured for one commune
 *    would publish two scores for it; dropping the row instead would leave
 *    nothing to explain why the directory's second URL is not in the data.
 *  - **Another host that also answered** — a real conflict. Sent to `a_revoir`,
 *    because which of two live sites is *the* municipal one is not something a
 *    status code can settle, and ranking it would publish a guess.
 *
 * An unattempted candidate on the elected host is closed without being fetched:
 * it is a page of a site we already have. One on another host is left alone —
 * it may be an alias, a dead link or a second site, and only a fetch can say.
 */
export function arbitrateCommune(candidates: readonly CandidateState[]): Arbitration {
  const verified = candidates.filter((candidate) => candidate.statut === 'verifie');
  const order = rankCandidates(verified.map((candidate) => candidate.url));
  const elected = verified.find((candidate) => candidate.url === order[0]);

  if (elected === undefined) return { elected: null, dispositions: [] };

  const electedUrl = effectiveUrl(elected);
  const dispositions: Disposition[] = [];

  for (const candidate of candidates) {
    if (candidate === elected) continue;
    // A decision already taken is not arbitration's to revisit: a scan may
    // never leave `a_revoir`, and may never resurrect an `invalide` (states.ts).
    if (candidate.statut !== 'candidat' && candidate.statut !== 'verifie') continue;

    if (isSameHost(effectiveUrl(candidate), electedUrl)) {
      dispositions.push({ url: candidate.url, to: 'invalide', reason: 'same-site-as-elected' });
      continue;
    }

    // Two live sites need a human; an unattempted URL on another host needs a
    // fetch, and gets to keep waiting for one.
    if (candidate.statut === 'verifie') {
      dispositions.push({ url: candidate.url, to: 'a_revoir', reason: 'several-verified' });
    }
  }

  return { elected: elected.url, dispositions };
}
