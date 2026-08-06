import { z } from 'zod';
import { SourceParseError } from './errors.js';

/**
 * The commune referential — API Découpage administratif, `geo.api.gouv.fr`
 * (docs/brief.md §4).
 *
 * Pure: it takes an already-decoded payload and returns records. Fetching is
 * somebody else's job (J1-14), which is what lets this be unit tested with
 * zero I/O.
 *
 * The schema is deliberately **permissive about what it accepts and strict
 * about what it produces**. Every constraint below was checked against the
 * full referential (34 969 communes, captured 6 August 2026) rather than
 * assumed, because a schema tightened on a guess rejects real data on the one
 * night nobody is watching. What that measurement found is recorded as
 * comments where the constraint is written, not in a commit message nobody
 * will read again.
 */
export const GEO_SOURCE = 'geo.api.gouv.fr';

export const GEO_COMMUNES_ENDPOINT = 'https://geo.api.gouv.fr/communes';

/**
 * The only fields we ask for. Requesting less is not an optimisation here, it
 * is the design: what is never fetched can never be stored by accident.
 */
export const GEO_COMMUNE_FIELDS = [
  'code',
  'nom',
  'population',
  'codeDepartement',
  'codeRegion',
  'codeEpci',
] as const;

/**
 * Five characters, second one possibly `A` or `B` for Corsica (`2A004`). Zero
 * of the 34 969 codes fall outside this shape, and the leading zero is why the
 * column is `text` in `src/db/schema.ts`.
 */
const INSEE_CODE = /^\d[\dAB]\d{3}$/;

const rawCommuneSchema = z.object({
  code: z.string().regex(INSEE_CODE),
  nom: z.string().min(1),
  /**
   * Optional *and* allowed to be zero.
   *
   * Optional: six entries carry no population at all — the Terres australes
   * and Clipperton, which are communes on paper and uninhabited in fact.
   *
   * Zero: six more report exactly 0 — Beaumont-en-Verdunois, Bezonvaux,
   * Cumières-le-Mort-Homme, Fleury-devant-Douaumont, Haumont-près-Samogneux
   * and Louvemont-Côte-du-Poivre, destroyed in 1916 and never rebuilt, still
   * legally communes. `positive()` here would have rejected them, and with
   * them the whole batch.
   */
  population: z.int().nonnegative().optional(),
  /** Two digits, three overseas, `2A`/`2B` for Corsica. */
  codeDepartement: z.string().regex(/^(\d{2,3}|2[AB])$/),
  codeRegion: z.string().regex(/^\d{2,3}$/),
  /** Nine digits, absent for the 98 communes belonging to no EPCI — mostly islands. */
  codeEpci: z
    .string()
    .regex(/^\d{9}$/)
    .optional(),
});

const rawCommunesSchema = z.array(rawCommuneSchema);

/**
 * A commune, in the vocabulary of `src/db/schema.ts`.
 *
 * `null` rather than `undefined` for the two optional fields: they map to
 * nullable columns, and one representation of "no value" travelling from the
 * parser to the database is one fewer place to get it wrong.
 */
export interface CommuneRecord {
  readonly codeInsee: string;
  readonly nom: string;
  readonly population: number | null;
  readonly departement: string;
  readonly region: string;
  readonly epci: string | null;
}

function toRecord(raw: z.infer<typeof rawCommuneSchema>): CommuneRecord {
  return {
    codeInsee: raw.code,
    nom: raw.nom,
    population: raw.population ?? null,
    departement: raw.codeDepartement,
    region: raw.codeRegion,
    epci: raw.codeEpci ?? null,
  };
}

/**
 * Parses the array `geo.api.gouv.fr` answers with, or throws naming every
 * record at fault — all of them, not just the first: a batch that fails on ten
 * malformed rows should be diagnosed in one pass, not in ten deployments.
 */
export function parseCommunes(payload: unknown): CommuneRecord[] {
  const result = rawCommunesSchema.safeParse(payload);

  if (!result.success) {
    throw new SourceParseError(
      GEO_SOURCE,
      result.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`),
    );
  }

  return result.data.map(toRecord);
}

/** The URL of a full referential pull, fields included. Nothing is fetched here. */
export function communesRequestUrl(): string {
  const url = new URL(GEO_COMMUNES_ENDPOINT);
  url.searchParams.set('fields', GEO_COMMUNE_FIELDS.join(','));
  return url.toString();
}
