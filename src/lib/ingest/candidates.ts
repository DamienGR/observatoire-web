import type { UrlSource } from '../../db/schema.js';
import { MAIRIE_PIVOT, isMairie, type AnnuaireRecord } from '../sources/annuaire.js';

/**
 * From town-hall records to candidate websites, per commune.
 *
 * Everything here **proposes**, nothing decides. A candidate may be an address
 * with no scheme, a deep link into a "mes démarches" section, or a site that
 * died in 2019 — all of it observed on the real directory. Sorting that out is
 * the resolution state machine's job (J1-06), and the reason the brief models
 * it as a process rather than a column: a rejection has to leave a trace, which
 * it cannot do if the value was dropped here.
 */

/** A row of `site`, before it exists. `communeId` is an INSEE code. */
export interface SiteCandidate {
  readonly communeId: string;
  readonly url: string;
  readonly source: UrlSource;
}

/** Every INSEE code a record speaks for **as a town hall**. */
function communeCodesOf(record: AnnuaireRecord): string[] {
  const codes = new Set<string>();

  // The top-level code and the pivot's can disagree — 13 records do, and
  // neither is authoritative (see the parser). Both are kept: the indexer's job
  // is to make the commune findable, not to arbitrate.
  if (record.codeInsee !== null) codes.add(record.codeInsee);

  for (const pivot of record.pivots) {
    // Only the `mairie` pivot. A record that is a `cg` for one commune and a
    // `mairie` for another must not lend its website to the first.
    if (pivot.typeServiceLocal !== MAIRIE_PIVOT) continue;
    for (const code of pivot.codesInsee) codes.add(code);
  }

  return [...codes];
}

/**
 * Groups the town-hall records by commune, in source order.
 *
 * A `Map` rather than a repeated scan: the perimeter has 1 067 communes and the
 * directory 35 803 records, so the alternative is 38 million comparisons for
 * the same answer.
 */
export function indexMairiesByCommune(
  records: readonly AnnuaireRecord[],
): Map<string, AnnuaireRecord[]> {
  const index = new Map<string, AnnuaireRecord[]>();

  for (const record of records) {
    // `statut_de_diffusion: "false"` marks a record the directory withdrew.
    // None of the 35 803 seen carries it, which is precisely why the field is
    // worth honouring: it exists to mark the exception.
    if (!record.published || !isMairie(record)) continue;

    for (const code of communeCodesOf(record)) {
      const bucket = index.get(code);
      if (bucket === undefined) index.set(code, [record]);
      else bucket.push(record);
    }
  }

  return index;
}

/**
 * The candidate websites of one commune, deduplicated and in source order.
 *
 * Source order carries information: the first value of the first record is the
 * one the directory presents as *the* website, and J1-06 will want to try it
 * first. Deduplication is exact-string — 57 candidates of the perimeter are a
 * town hall and its annexe naming the same site — and stops short of any
 * normalisation. Deciding that `http://x.fr` and `https://x.fr/` are the same
 * site is a judgement about the site, not about the string.
 */
export function candidatesFor(
  codeInsee: string,
  index: ReadonlyMap<string, readonly AnnuaireRecord[]>,
): SiteCandidate[] {
  const seen = new Set<string>();
  const candidates: SiteCandidate[] = [];

  for (const record of index.get(codeInsee) ?? []) {
    for (const url of record.urls) {
      if (seen.has(url)) continue;
      seen.add(url);
      candidates.push({ communeId: codeInsee, url, source: 'annuaire' });
    }
  }

  return candidates;
}
