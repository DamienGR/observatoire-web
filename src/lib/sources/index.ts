/**
 * Parsers for the two referentials of docs/brief.md §4.
 *
 * Everything here is pure — a payload in, records out. No module below fetches
 * anything: the transport belongs to `src/lib/fetch/` and the schedule to the
 * ingestion job (J1-14). That separation is what lets the shape of two moving
 * third-party APIs be pinned by unit tests against frozen fixtures.
 */
export { SourceParseError } from './errors.js';

export {
  GEO_COMMUNE_FIELDS,
  GEO_COMMUNES_ENDPOINT,
  GEO_SOURCE,
  communesRequestUrl,
  parseCommunes,
} from './geo.js';
export type { CommuneRecord } from './geo.js';

export {
  ANNUAIRE_DATASET_ENDPOINT,
  ANNUAIRE_FIELDS,
  ANNUAIRE_SOURCE,
  MAIRIE_PIVOT,
  isMairie,
  mairiesRequestUrl,
  parseAnnuairePage,
  parseAnnuaireRecords,
} from './annuaire.js';
export type { AnnuairePage, AnnuairePivot, AnnuaireRecord } from './annuaire.js';
