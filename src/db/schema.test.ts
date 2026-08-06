import { getTableConfig, PgDialect, type PgTable } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import {
  commune,
  finding,
  FINDING_IMPACTS,
  measurement,
  MEASUREMENT_STATUSES,
  oneOf,
  scanRun,
  SCAN_RUN_STATUSES,
  site,
  STATUTS_RESOLUTION,
  URL_SOURCES,
} from './schema.js';

/**
 * The schema is data, so it drifts silently. These assertions state what the
 * contract requires of it — table names, `methodology_version`, idempotence
 * keys, no raw report, UTC timestamps — so that a future edit that breaks one
 * of those rules fails here rather than three milestones later on real data.
 *
 * Everything below reads the schema object in memory. No connection, no
 * migration, no I/O: the anti-I/O guard of the unit project stays satisfied
 * (CLAUDE.md §5). Whether the *database* enforces these constraints is a
 * different question, answered by the integration layer (J1-11).
 */
const TABLES = { commune, site, scanRun, measurement, finding } as const;

function configOf(table: PgTable) {
  return getTableConfig(table);
}

function columnNames(table: PgTable): string[] {
  return configOf(table).columns.map((column) => column.name);
}

function checkNamed(table: PgTable, name: string) {
  return configOf(table).checks.find((constraint) => constraint.name === name);
}

/** Renders a constraint the way drizzle-kit does when it writes the migration. */
const dialect = new PgDialect();

function renderCheck(table: PgTable, name: string): string | undefined {
  const constraint = checkNamed(table, name);
  return constraint === undefined ? undefined : dialect.sqlToQuery(constraint.value).sql;
}

describe('the five tables of the brief', () => {
  it('carries the names of docs/brief.md §6, verbatim', () => {
    // CLAUDE.md §4: "Les noms de tables et de colonnes suivent le modèle de
    // données du brief verbatim". Renaming one is a decision, not a refactor.
    expect(
      Object.values(TABLES)
        .map((table) => configOf(table).name)
        .sort(),
    ).toEqual(['commune', 'finding', 'measurement', 'scan_run', 'site']);
  });

  it('names every column the brief names', () => {
    expect(columnNames(commune)).toEqual(
      expect.arrayContaining(['code_insee', 'nom', 'population', 'departement', 'region', 'epci']),
    );
    expect(columnNames(site)).toEqual(
      expect.arrayContaining(['commune_id', 'url', 'statut_resolution', 'source', 'verified_at']),
    );
    expect(columnNames(scanRun)).toEqual(
      expect.arrayContaining(['id', 'started_at', 'finished_at', 'statut', 'methodology_version']),
    );
    expect(columnNames(measurement)).toEqual(
      expect.arrayContaining([
        'scan_run_id',
        'site_id',
        'url',
        'fetched_at',
        'http_status',
        'error_code',
      ]),
    );
    expect(columnNames(finding)).toEqual(
      expect.arrayContaining(['measurement_id', 'rule_id', 'impact', 'occurrences']),
    );
  });
});

describe('methodology_version, on every measurement', () => {
  // CLAUDE.md §11.2, and the precondition of milestone 5: without it, the
  // scoring cannot change without betraying the history it already published.
  it.each([
    ['scan_run', scanRun],
    ['measurement', measurement],
  ] as const)('is declared not-null on %s', (_name, table) => {
    const column = configOf(table).columns.find((c) => c.name === 'methodology_version');

    expect(column).toBeDefined();
    expect(column?.notNull).toBe(true);
    expect(column?.hasDefault).toBe(false);
  });

  it('leaves no default that would let a caller forget it', () => {
    // A default would turn "which methodology produced this?" into a guess the
    // schema makes on the caller's behalf — the exact failure §11.2 forbids.
    expect(checkNamed(measurement, 'measurement_methodology_version_present')).toBeDefined();
    expect(checkNamed(scanRun, 'scan_run_methodology_version_present')).toBeDefined();
  });
});

describe('a scan is idempotent and resumable', () => {
  it('lets a run measure a site at most once', () => {
    const unique = configOf(measurement).indexes.find(
      (i) => i.config.name === 'measurement_run_site_key',
    );

    expect(unique?.config.unique).toBe(true);
    expect(unique?.config.columns.map((c) => ('name' in c ? c.name : ''))).toEqual([
      'scan_run_id',
      'site_id',
    ]);
  });

  it('lets a measurement record a rule at most once', () => {
    const unique = configOf(finding).indexes.find(
      (i) => i.config.name === 'finding_measurement_rule_key',
    );

    expect(unique?.config.unique).toBe(true);
  });

  it('lets the directory propose the same URL twice without duplicating a site', () => {
    const unique = configOf(site).indexes.find((i) => i.config.name === 'site_commune_url_key');

    expect(unique?.config.unique).toBe(true);
  });

  it('gives each measurement its own status and its own attempt count', () => {
    // "Chaque mesure porte son propre statut" (docs/brief.md §6). A status held
    // only by the run is what forces "the job crashed, start over".
    const columns = columnNames(measurement);

    expect(columns).toContain('statut');
    expect(columns).toContain('attempts');
  });
});

describe('no raw Lighthouse report, anywhere', () => {
  // CLAUDE.md §11.1. 300–500 kB a piece, ~1 000 measurements a week: the free
  // Neon tier is 0.5 GB. The rule is easiest to break by adding one json
  // column "just for debugging", which is what this test watches for.
  it.each(Object.entries(TABLES))('stores no json column on %s', (_name, table) => {
    const jsonColumns = configOf(table)
      .columns.filter((column) => /json/i.test(column.getSQLType()))
      .map((column) => column.name);

    expect(jsonColumns).toEqual([]);
  });

  it('keeps every measurement column a scalar of bounded size', () => {
    const oversized = configOf(measurement)
      .columns.filter((column) => column.getSQLType().endsWith('[]'))
      .map((column) => column.name);

    expect(oversized).toEqual([]);
  });
});

describe('timestamps', () => {
  it.each(Object.entries(TABLES))('stores every %s timestamp with a time zone', (_name, table) => {
    // CLAUDE.md §4: stored and manipulated in UTC, formatted in Europe/Paris at
    // display time only. A bare `timestamp` silently drops the offset.
    const naive = configOf(table)
      .columns.filter((column) => column.getSQLType().startsWith('timestamp'))
      .filter((column) => !column.getSQLType().includes('with time zone'))
      .map((column) => column.name);

    expect(naive).toEqual([]);
  });
});

describe('status vocabularies', () => {
  // The tuple types the TypeScript union; the CHECK constraint enforces it in
  // the database. This is what keeps the two from drifting apart — a value
  // added to the tuple and not to the constraint would be accepted by the
  // compiler and rejected by Postgres, at runtime, in production.
  it.each([
    ['site_statut_resolution_known', site, STATUTS_RESOLUTION],
    ['site_source_known', site, URL_SOURCES],
    ['scan_run_statut_known', scanRun, SCAN_RUN_STATUSES],
    ['measurement_statut_known', measurement, MEASUREMENT_STATUSES],
    ['finding_impact_known', finding, FINDING_IMPACTS],
  ] as const)('checks %s against its declared values', (name, table, values) => {
    const rendered = renderCheck(table, name);
    expect(rendered).toBeDefined();

    for (const value of values) {
      expect(rendered).toContain(`'${value}'`);
    }
  });

  it('spells the resolution states the way the brief does', () => {
    // French, like the column that holds them: the brief names these states
    // (candidat → vérifié → invalide → à revoir) and J1-06 builds its state
    // machine on them rather than on a second, translated list.
    expect(STATUTS_RESOLUTION).toEqual(['candidat', 'verifie', 'invalide', 'a_revoir']);
  });

  it('refuses a value that would not survive being quoted into SQL', () => {
    expect(() => oneOf(site.statutResolution, ["candidat'; drop table site --"])).toThrow(
      /Unsafe value/,
    );
  });
});

describe('deletion rules', () => {
  it('keeps published history from disappearing as a side effect', () => {
    // A run is an operation and can be discarded with its measurements; a site
    // carries history the site publishes, so deleting one has to be refused
    // until someone decides what happens to that history.
    const foreignKeys = configOf(measurement).foreignKeys;
    const towards = (target: PgTable) =>
      foreignKeys.find((key) => key.reference().foreignTable === target);

    expect(towards(site)?.onDelete).toBe('restrict');
    expect(towards(scanRun)?.onDelete).toBe('cascade');
  });

  it('removes the findings of a measurement that goes away', () => {
    const [key] = configOf(finding).foreignKeys;

    expect(key?.reference().foreignTable).toBe(measurement);
    expect(key?.onDelete).toBe('cascade');
  });
});
