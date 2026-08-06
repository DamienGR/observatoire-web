import { z } from 'zod';
import { SourceParseError } from './errors.js';

/**
 * The directory of public services — DILA, served on
 * `api-lannuaire.service-public.gouv.fr` (docs/brief.md §4; the old
 * `service-public.fr` domain is no longer to be used).
 *
 * This parser exists because the payload is *odd*, in two ways that were
 * measured on the 35 803 `mairie` records captured on 6 August 2026 and are
 * encoded below rather than remembered:
 *
 *  1. **Structured fields are JSON encoded inside a string.** `site_internet`
 *     and `pivot` arrive as `"[{\"valeur\": …}]"`, so they need decoding
 *     before validating — a string that happens to be JSON is not JSON to a
 *     schema. 13 656 of the records have no website, and say so with a plain
 *     `null`.
 *  2. **The two endpoints disagree on their envelope.** `/records` wraps
 *     results in `{total_count, results}`; `/exports/json` returns the bare
 *     array. Both are parsed here, because discovering that in a job is a
 *     wasted run.
 *
 * What this module does *not* do is judge a URL. A `valeur` may be an email
 * address, a hostname with no scheme, or a link that died in 2019 — all of it
 * observed. Sorting that out is the resolution state machine's job (J1-06) and
 * the SSRF guard's (`src/lib/fetch/`); a parser that quietly dropped the ugly
 * values would hide exactly the data the brief says to model as a process.
 */
export const ANNUAIRE_SOURCE = 'annuaire';

export const ANNUAIRE_DATASET_ENDPOINT =
  'https://api-lannuaire.service-public.gouv.fr/api/explore/v2.1/catalog/datasets/api-lannuaire-administration';

/**
 * The only fields we ask for, and the reason no personal data reaches this
 * repository: the records also carry `adresse_courriel`, `telephone` and
 * `affectation_personne`, which CLAUDE.md §7 forbids us to hold. Not
 * requesting them is stronger than filtering them out afterwards — there is no
 * step left where someone can forget.
 */
export const ANNUAIRE_FIELDS = [
  'id',
  'nom',
  'code_insee_commune',
  'site_internet',
  'pivot',
  'statut_de_diffusion',
  'date_modification_datetime',
] as const;

/** The `pivot` value identifying a town hall among every other public service. */
export const MAIRIE_PIVOT = 'mairie';

const INSEE_CODE = /^\d[\dAB]\d{3}$/;

/**
 * `null` and `""` both mean "no value" here, and both become `undefined` so
 * that one `.optional()` covers them.
 *
 * A caution earned the hard way, worth leaving in writing: inspecting this API
 * through a Python REPL prints an absent field as `None`, and it is very easy
 * to conclude that the API sends the *string* `"None"` and to write a defence
 * against a sentinel that does not exist. It does not: the raw bytes hold
 * `null`, 13 656 times, and zero occurrences of `"None"`.
 */
function blankToUndefined(value: unknown): unknown {
  if (value === null) return undefined;
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

/** Oddity 1: JSON hiding inside a string. */
function embeddedJsonArray<T extends z.ZodType>(item: T) {
  return z.preprocess(
    blankToUndefined,
    z
      .string()
      .transform((value, ctx) => {
        try {
          return JSON.parse(value) as unknown;
        } catch {
          ctx.addIssue({
            code: 'custom',
            // The value itself is never echoed: it is third-party content and
            // this message can end up in a log.
            message: 'expected JSON encoded inside a string',
          });
          return z.NEVER;
        }
      })
      .pipe(z.array(item))
      .optional(),
  );
}

const websiteSchema = z.object({
  valeur: z.string(),
  libelle: z.string(),
});

const pivotSchema = z.object({
  type_service_local: z.string(),
  code_insee_commune: z.array(z.string().regex(INSEE_CODE)),
});

const rawRecordSchema = z.object({
  id: z.uuid(),
  nom: z.string().min(1),
  code_insee_commune: z.preprocess(blankToUndefined, z.string().regex(INSEE_CODE).optional()),
  site_internet: embeddedJsonArray(websiteSchema),
  pivot: embeddedJsonArray(pivotSchema),
  /** A string, not a boolean: `"true"` on all 35 803 records seen. */
  statut_de_diffusion: z.enum(['true', 'false']).optional(),
  date_modification_datetime: z.iso.datetime({ offset: true }).optional(),
});

const rawRecordsSchema = z.array(rawRecordSchema);

/** Oddity 2: the `/records` envelope. `/exports/json` has none. */
const pageSchema = z.object({
  total_count: z.int().nonnegative(),
  results: rawRecordsSchema,
});

export interface AnnuairePivot {
  /** `mairie` for a town hall. A record may declare more than one role. */
  readonly typeServiceLocal: string;
  readonly codesInsee: readonly string[];
}

export interface AnnuaireRecord {
  readonly id: string;
  /** e.g. `Mairie - Curgy`, `Mairie annexe - Ronel`, `Mairie déléguée - …`. */
  readonly nom: string;
  /**
   * The code the record carries at top level.
   *
   * It is **not** always the code its `pivot` block claims: on 13 records —
   * `Mairie déléguée` entries, mostly — the top-level code names the merged-away
   * commune while the pivot names the current one. Cross-checked against the
   * referential, the pivot wins 733 times and the top level 3 times, so neither
   * is authoritative on its own and both are handed over intact.
   */
  readonly codeInsee: string | null;
  readonly pivots: readonly AnnuairePivot[];
  /** Every website value proposed, in source order, empty ones removed. Unjudged. */
  readonly urls: readonly string[];
  readonly published: boolean;
  readonly modifiedAt: Date | null;
}

function toRecord(raw: z.infer<typeof rawRecordSchema>): AnnuaireRecord {
  return {
    id: raw.id,
    nom: raw.nom,
    codeInsee: raw.code_insee_commune ?? null,
    pivots: (raw.pivot ?? []).map((pivot) => ({
      typeServiceLocal: pivot.type_service_local,
      codesInsee: pivot.code_insee_commune,
    })),
    urls: (raw.site_internet ?? [])
      .map((site) => site.valeur.trim())
      .filter((value) => value !== ''),
    // Absent means published: the field exists to mark the exception.
    published: raw.statut_de_diffusion !== 'false',
    modifiedAt:
      raw.date_modification_datetime === undefined
        ? null
        : new Date(raw.date_modification_datetime),
  };
}

function fail(issues: z.core.$ZodIssue[]): never {
  throw new SourceParseError(
    ANNUAIRE_SOURCE,
    issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`),
  );
}

/** Parses the bare array `/exports/json` returns. */
export function parseAnnuaireRecords(payload: unknown): AnnuaireRecord[] {
  const result = rawRecordsSchema.safeParse(payload);
  if (!result.success) fail(result.error.issues);

  return result.data.map(toRecord);
}

export interface AnnuairePage {
  readonly totalCount: number;
  readonly records: readonly AnnuaireRecord[];
}

/** Parses the `{total_count, results}` envelope `/records` returns. */
export function parseAnnuairePage(payload: unknown): AnnuairePage {
  const result = pageSchema.safeParse(payload);
  if (!result.success) fail(result.error.issues);

  return {
    totalCount: result.data.total_count,
    records: result.data.results.map(toRecord),
  };
}

/**
 * Whether a record describes a town hall.
 *
 * `some`, not `pivots[0]`, and the difference is not theoretical: one record
 * out of 35 803 declares two roles. The Conseil territorial de
 * Saint-Barthélemy is a `cg` *and* a `mairie`, in that order, so reading only
 * the first pivot drops the commune from the perimeter — silently, and only
 * for that one commune.
 */
export function isMairie(record: AnnuaireRecord): boolean {
  return record.pivots.some((pivot) => pivot.typeServiceLocal === MAIRIE_PIVOT);
}

/** The URL of one page of town-hall records. Nothing is fetched here. */
export function mairiesRequestUrl(options: { limit: number; offset?: number }): string {
  const url = new URL(`${ANNUAIRE_DATASET_ENDPOINT}/records`);
  url.searchParams.set('where', `pivot like "${MAIRIE_PIVOT}"`);
  url.searchParams.set('select', ANNUAIRE_FIELDS.join(','));
  url.searchParams.set('limit', String(options.limit));
  if (options.offset !== undefined) url.searchParams.set('offset', String(options.offset));
  return url.toString();
}
