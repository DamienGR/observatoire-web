import { sql, type SQL } from 'drizzle-orm';
import {
  bigint,
  bigserial,
  boolean,
  check,
  doublePrecision,
  index,
  integer,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';

/**
 * The five tables of docs/brief.md §6 — `commune`, `site`, `scan_run`,
 * `measurement`, `finding`.
 *
 * Naming follows the brief verbatim (CLAUDE.md §4), which is why French
 * business vocabulary sits next to English identifiers in the same table:
 * `statut`, `statut_resolution`, `code_insee`, `commune` are the brief's words
 * and have no faithful English equivalent, everything the brief does not name
 * is English like the rest of the code. One documented deviation: the brief
 * writes `dept`, CLAUDE.md §4 sanctions `departement` — the contract wins on
 * matters of implementation, and an abbreviation nobody expands is a poor
 * trade against three saved characters.
 *
 * Three rules of the contract are encoded here rather than trusted:
 *
 *  1. **No measurement without `methodology_version`** (CLAUDE.md §11.2). The
 *     column is `not null` on both `scan_run` and `measurement`: the run
 *     declares the version it was launched under, the measurement records the
 *     version actually applied to it. They only differ when a run is resumed
 *     across a methodology change — precisely the case milestone 5 exists to
 *     exercise, and precisely the case a single column on `scan_run` would
 *     silently misreport.
 *  2. **A scan is idempotent and resumable per commune** (CLAUDE.md §8). Each
 *     measurement carries its own `statut` and its own attempt count, and
 *     `(scan_run_id, site_id)` is unique — replaying a run cannot duplicate a
 *     measurement, so "the job crashed, start over" never becomes the fix.
 *  3. **Raw Lighthouse reports are never stored** (CLAUDE.md §11.1). There is
 *     no json column anywhere below, and `src/db/schema.test.ts` fails if one
 *     appears: 300–500 kB a piece would fill the free Neon tier in weeks.
 *
 * There is deliberately **no composite score column**. Its formula is an open
 * decision (docs/brief.md §11) and adding the column now would settle it by
 * accident. A measurement stores signals; their weighting belongs to the PR
 * that decides it, together with the migration that adds the column.
 */

/**
 * A `text` column typed by a tuple gives TypeScript the union but leaves the
 * database with a bare `text`. This turns the same tuple into a CHECK
 * constraint so the two cannot drift.
 *
 * A CHECK rather than a Postgres `enum` on purpose: milestone 5 migrates a
 * live schema, and `ALTER TYPE … ADD VALUE` carries transaction restrictions
 * that a `DROP CONSTRAINT` / `ADD CONSTRAINT` pair does not. The check is the
 * boring option, and boring is what a migration on production data wants.
 */
const VALUE_PATTERN = /^[a-z][a-z0-9_]*$/;

/** Exported for its test: a guard whose alarm nobody has heard is not a guard. */
export function oneOf(column: AnyPgColumn, values: readonly [string, ...string[]]): SQL {
  const literals = values.map((value) => {
    // Values are compile-time constants of this module; the guard is here so
    // that a future one containing a quote fails loudly at import time rather
    // than producing a migration nobody reads before applying it.
    if (!VALUE_PATTERN.test(value)) {
      throw new Error(`Unsafe value in a CHECK constraint: ${JSON.stringify(value)}`);
    }
    return `'${value}'`;
  });

  return sql`${column} in (${sql.raw(literals.join(', '))})`;
}

/**
 * The URL resolution states of docs/brief.md §4. Named by the brief, so kept
 * in French like the column that holds them. The transitions between them are
 * a state machine, not a column — it lands in `src/lib/` with J1-06, and it
 * imports these values rather than restating them.
 */
export const STATUTS_RESOLUTION = ['candidat', 'verifie', 'invalide', 'a_revoir'] as const;
export type StatutResolution = (typeof STATUTS_RESOLUTION)[number];

/** Where a candidate URL came from. `annuaire` is the DILA directory. */
export const URL_SOURCES = ['annuaire', 'heuristique', 'manuel'] as const;
export type UrlSource = (typeof URL_SOURCES)[number];

/** A run is created running; it never sits in a queue waiting to start. */
export const SCAN_RUN_STATUSES = ['running', 'succeeded', 'failed', 'cancelled'] as const;
export type ScanRunStatus = (typeof SCAN_RUN_STATUSES)[number];

/**
 * The per-measurement status that makes a run resumable: a resumed run picks up
 * `pending` and `failed` rows and leaves `succeeded` ones alone. `running` is
 * what an interrupted job leaves behind — a row that is visibly stuck rather
 * than a row that is lost, `updated_at` saying since when. *How long* a stuck
 * row waits before being retried is a policy of the scan job, not of the
 * schema; it lands with the ops surface at milestone 2.
 */
export const MEASUREMENT_STATUSES = [
  'pending',
  'running',
  'succeeded',
  'failed',
  'skipped',
] as const;
export type MeasurementStatus = (typeof MEASUREMENT_STATUSES)[number];

/** axe-core impact levels, reported as such by Lighthouse. English at source. */
export const FINDING_IMPACTS = ['minor', 'moderate', 'serious', 'critical'] as const;
export type FindingImpact = (typeof FINDING_IMPACTS)[number];

/** Every timestamp is `timestamptz`, stored in UTC (CLAUDE.md §4). */
const timestamptz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

/**
 * The commune referential, ingested from `geo.api.gouv.fr` (J1-14).
 *
 * `code_insee` is the primary key rather than a surrogate id: it is stable,
 * externally meaningful, and it makes re-ingestion an upsert instead of a
 * matching problem. It is `text`, not a number — `2A004` and `2B033` are
 * Corsican communes, and a numeric column would have silently dropped them
 * along with every leading zero.
 */
export const commune = pgTable(
  'commune',
  {
    codeInsee: text('code_insee').primaryKey(),
    nom: text('nom').notNull(),
    population: integer('population').notNull(),
    departement: text('departement').notNull(),
    region: text('region').notNull(),
    // Nullable: a handful of communes belong to no EPCI, and inventing one
    // would be worse than recording that they have none.
    epci: text('epci'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    updatedAt: timestamptz('updated_at')
      .notNull()
      .defaultNow()
      // Maintained by the writer rather than by a trigger: every write goes
      // through Drizzle here, and a column that only *looks* maintained is
      // worse than no column at all.
      .$onUpdate(() => new Date()),
  },
  (table) => [
    // Five characters, always. This is the assertion that catches an INSEE code
    // read as an integer somewhere upstream: `01004` coming back as `1004`.
    check('commune_code_insee_length', sql`char_length(${table.codeInsee}) = 5`),
    // `>= 0`, not `> 0`, and the difference is six real communes: Beaumont-en-
    // Verdunois, Bezonvaux, Cumières-le-Mort-Homme, Fleury-devant-Douaumont,
    // Haumont-près-Samogneux and Louvemont-Côte-du-Poivre were destroyed in
    // 1916 and never rebuilt. They are still legally communes and the
    // referential reports 0 inhabitants for each. The original `> 0` was
    // written from an assumption about what a commune is; J1-07 measured it.
    check('commune_population_not_negative', sql`${table.population} >= 0`),
    index('commune_departement_idx').on(table.departement),
    index('commune_region_idx').on(table.region),
    // The v1 perimeter is a population threshold, and the rankings are sorted
    // by it (docs/brief.md §3).
    index('commune_population_idx').on(table.population),
  ],
);

/**
 * The website of a commune, and the state of its resolution.
 *
 * A table rather than a column on `commune`, because the directory URL is
 * incomplete and sometimes stale (docs/brief.md §4): a commune can carry
 * several candidates at once, and rejecting one has to leave a trace. The
 * measurement points at a `site`, so history survives a commune changing its
 * address.
 */
export const site = pgTable(
  'site',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    communeId: text('commune_id')
      .notNull()
      .references(() => commune.codeInsee, { onDelete: 'cascade' }),
    url: text('url').notNull(),
    statutResolution: text('statut_resolution', { enum: STATUTS_RESOLUTION })
      .notNull()
      .default('candidat'),
    source: text('source', { enum: URL_SOURCES }).notNull(),
    verifiedAt: timestamptz('verified_at'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    updatedAt: timestamptz('updated_at')
      .notNull()
      .defaultNow()
      // Maintained by the writer rather than by a trigger: every write goes
      // through Drizzle here, and a column that only *looks* maintained is
      // worse than no column at all.
      .$onUpdate(() => new Date()),
  },
  (table) => [
    check('site_statut_resolution_known', oneOf(table.statutResolution, STATUTS_RESOLUTION)),
    check('site_source_known', oneOf(table.source, URL_SOURCES)),
    // Re-ingesting the directory must converge rather than accumulate: the same
    // URL proposed twice for the same commune is one row.
    uniqueIndex('site_commune_url_key').on(table.communeId, table.url),
    index('site_commune_idx').on(table.communeId),
    // "Which sites still need a decision?" is the query the ops surface asks.
    index('site_statut_resolution_idx').on(table.statutResolution),
  ],
);

/**
 * One pass of the scanner over a set of sites.
 *
 * `finished_at` stays null while the run is in flight, which is also how an
 * interrupted run is recognised: `statut = 'running'` with nothing progressing.
 * Nothing here says which sites the run covers — that is the set of its
 * measurements, and it is what makes a partial run a first-class object rather
 * than an accident.
 */
export const scanRun = pgTable(
  'scan_run',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    startedAt: timestamptz('started_at').notNull().defaultNow(),
    finishedAt: timestamptz('finished_at'),
    statut: text('statut', { enum: SCAN_RUN_STATUSES }).notNull().default('running'),
    methodologyVersion: text('methodology_version').notNull(),
  },
  (table) => [
    check('scan_run_statut_known', oneOf(table.statut, SCAN_RUN_STATUSES)),
    check(
      'scan_run_methodology_version_present',
      sql`char_length(${table.methodologyVersion}) > 0`,
    ),
    // A finished run has an end, an unfinished one has none. Encoded, because
    // "finished but still running" is the state that makes a resume loop spin.
    check(
      'scan_run_finished_at_matches_statut',
      sql`(${table.statut} = 'running') = (${table.finishedAt} is null)`,
    ),
    index('scan_run_statut_idx').on(table.statut),
    index('scan_run_started_at_idx').on(table.startedAt),
  ],
);

/**
 * One site, measured once, inside one run.
 *
 * The columns are the twenty-odd metrics extracted from the Lighthouse report
 * plus the complementary signals of docs/brief.md §4. The report itself is
 * discarded (CLAUDE.md §11.1).
 *
 * Every measured column is nullable, and the distinction matters: `null` means
 * *not measured* — the row is pending, or the fetch failed — while `false` or
 * `0` means measured and absent. Collapsing the two would publish "this commune
 * has no accessibility statement" about a site nobody could reach.
 */
export const measurement = pgTable(
  'measurement',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    scanRunId: bigint('scan_run_id', { mode: 'number' })
      .notNull()
      .references(() => scanRun.id, { onDelete: 'cascade' }),
    // `restrict`, unlike the cascade above: a run is an operation and can be
    // discarded, a site carries published history and cannot disappear as a
    // side effect of deleting something else.
    siteId: bigint('site_id', { mode: 'number' })
      .notNull()
      .references(() => site.id, { onDelete: 'restrict' }),
    /** The URL as requested. Denormalised on purpose: `site.url` can change. */
    url: text('url').notNull(),
    /** Where the redirects landed, when they moved (SSRF guard, CLAUDE.md §7). */
    finalUrl: text('final_url'),
    statut: text('statut', { enum: MEASUREMENT_STATUSES }).notNull().default('pending'),
    methodologyVersion: text('methodology_version').notNull(),
    fetchedAt: timestamptz('fetched_at'),
    httpStatus: integer('http_status'),
    /** A stable code, never a message: it is grouped on, not read as prose. */
    errorCode: text('error_code'),
    /** Bounds the retry loop of a resumed run (CLAUDE.md §8). */
    attempts: integer('attempts').notNull().default(0),

    // --- Lighthouse category scores, 0–100 ---
    // PSI returns them as a 0–1 value rounded to two decimals, so an integer
    // percentage is lossless rather than a convenient approximation.
    performanceScore: smallint('performance_score'),
    accessibilityScore: smallint('accessibility_score'),
    bestPracticesScore: smallint('best_practices_score'),
    seoScore: smallint('seo_score'),

    // --- Lighthouse metrics ---
    lcpMs: integer('lcp_ms'),
    fcpMs: integer('fcp_ms'),
    speedIndexMs: integer('speed_index_ms'),
    tbtMs: integer('tbt_ms'),
    ttiMs: integer('tti_ms'),
    cls: doublePrecision('cls'),

    // --- Complementary signals, from the direct HTML fetch ---
    hasAccessibilityStatement: boolean('has_accessibility_statement'),
    accessibilityStatementUrl: text('accessibility_statement_url'),
    hasLegalNotice: boolean('has_legal_notice'),
    hasPrivacyPolicy: boolean('has_privacy_policy'),
    hasHsts: boolean('has_hsts'),
    hasCsp: boolean('has_csp'),
    hasXContentTypeOptions: boolean('has_x_content_type_options'),
    cms: text('cms'),

    createdAt: timestamptz('created_at').notNull().defaultNow(),
    updatedAt: timestamptz('updated_at')
      .notNull()
      .defaultNow()
      // Maintained by the writer rather than by a trigger: every write goes
      // through Drizzle here, and a column that only *looks* maintained is
      // worse than no column at all.
      .$onUpdate(() => new Date()),
  },
  (table) => [
    check('measurement_statut_known', oneOf(table.statut, MEASUREMENT_STATUSES)),
    check(
      'measurement_methodology_version_present',
      sql`char_length(${table.methodologyVersion}) > 0`,
    ),
    check('measurement_attempts_positive', sql`${table.attempts} >= 0`),
    check(
      'measurement_scores_in_range',
      sql`
        (${table.performanceScore} is null or ${table.performanceScore} between 0 and 100)
        and (${table.accessibilityScore} is null or ${table.accessibilityScore} between 0 and 100)
        and (${table.bestPracticesScore} is null or ${table.bestPracticesScore} between 0 and 100)
        and (${table.seoScore} is null or ${table.seoScore} between 0 and 100)
      `,
    ),
    check(
      'measurement_metrics_positive',
      sql`
        (${table.lcpMs} is null or ${table.lcpMs} >= 0)
        and (${table.fcpMs} is null or ${table.fcpMs} >= 0)
        and (${table.speedIndexMs} is null or ${table.speedIndexMs} >= 0)
        and (${table.tbtMs} is null or ${table.tbtMs} >= 0)
        and (${table.ttiMs} is null or ${table.ttiMs} >= 0)
        and (${table.cls} is null or ${table.cls} >= 0)
      `,
    ),
    // Idempotence, as a constraint rather than as a convention: a run measures
    // a site at most once, so replaying it updates instead of duplicating.
    uniqueIndex('measurement_run_site_key').on(table.scanRunId, table.siteId),
    // The resume query: what is left to do in this run.
    index('measurement_run_statut_idx').on(table.scanRunId, table.statut),
    // The commune page: this site's measurements, most recent first.
    index('measurement_site_fetched_at_idx').on(table.siteId, table.fetchedAt.desc()),
  ],
);

/**
 * One accessibility rule violated by one measurement.
 *
 * `occurrences` rather than one row per node: the node list is part of the raw
 * report we do not keep, and "37 contrast failures" is the number the page
 * shows anyway.
 */
export const finding = pgTable(
  'finding',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    measurementId: bigint('measurement_id', { mode: 'number' })
      .notNull()
      .references(() => measurement.id, { onDelete: 'cascade' }),
    /** The axe-core rule id, e.g. `color-contrast`. */
    ruleId: text('rule_id').notNull(),
    impact: text('impact', { enum: FINDING_IMPACTS }).notNull(),
    occurrences: integer('occurrences').notNull().default(1),
  },
  (table) => [
    check('finding_impact_known', oneOf(table.impact, FINDING_IMPACTS)),
    check('finding_occurrences_positive', sql`${table.occurrences} > 0`),
    // Same idempotence as above, one level down: re-recording the findings of a
    // replayed measurement updates the counts instead of doubling them.
    uniqueIndex('finding_measurement_rule_key').on(table.measurementId, table.ruleId),
    // "Which rules fail most often" — the barometer of docs/brief.md §3.
    index('finding_rule_idx').on(table.ruleId),
  ],
);

export type Commune = typeof commune.$inferSelect;
export type NewCommune = typeof commune.$inferInsert;
export type Site = typeof site.$inferSelect;
export type NewSite = typeof site.$inferInsert;
export type ScanRun = typeof scanRun.$inferSelect;
export type NewScanRun = typeof scanRun.$inferInsert;
export type Measurement = typeof measurement.$inferSelect;
export type NewMeasurement = typeof measurement.$inferInsert;
export type Finding = typeof finding.$inferSelect;
export type NewFinding = typeof finding.$inferInsert;
