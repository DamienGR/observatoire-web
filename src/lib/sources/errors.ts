/**
 * Every external payload is parsed by a Zod schema before use, and a missing
 * or unexpectedly typed field is an explicit error rather than an `undefined`
 * that propagates (CLAUDE.md §4).
 *
 * These errors say *which* source and *which* record failed, because the two
 * questions a 3 a.m. ingestion failure raises are "whose fault" and "which
 * row" — and an error that answers neither costs an hour.
 */
export class SourceParseError extends Error {
  override readonly name = 'SourceParseError';
  /** Identifies the upstream, e.g. `geo.api.gouv.fr` or `annuaire`. */
  readonly source: string;
  readonly issues: readonly string[];

  constructor(source: string, issues: readonly string[]) {
    super(
      `${source} returned a payload this version cannot parse:\n` +
        `${issues.map((issue) => `  - ${issue}`).join('\n')}\n` +
        'If the upstream shape genuinely changed, the fixtures under ' +
        'tests/fixtures/ and the schema must move together.',
    );
    this.source = source;
    this.issues = issues;
  }
}
