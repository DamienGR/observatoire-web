/**
 * An error and the chain of causes under it, as one line.
 *
 * This exists because of a diagnosis that cost a round trip. A dispatched
 * ingestion failed and reported:
 *
 *     Error: Failed query: select count(*) from "commune"
 *
 * which says that something went wrong and nothing about what. Drizzle wraps
 * the driver's error, so the reason — `relation "commune" does not exist` —
 * was one `cause` away and was thrown out by a handler printing
 * `${error.name}: ${error.message}` (docs/journal.md 021).
 *
 * In a project whose only window on a job is its log, an error message that
 * omits its cause is not a cosmetic problem: it is the difference between
 * knowing the database has no schema and knowing nothing at all.
 *
 * Only names and messages are emitted. Never a stack, never a payload: this log
 * is public on a public repository, and §7 keeps a connection string out of a
 * logger by not handing it one.
 */

/** Deep enough for a driver wrapped twice; shallow enough to stay one line. */
const MAX_DEPTH = 5;

/**
 * Something thrown that is not an `Error` — legal JavaScript, and a dependency
 * will do it eventually.
 *
 * Primitives are reported as themselves; anything else becomes `unknown error`
 * rather than being stringified. That is not only because `String({})` reads
 * `[object Object]`: an arbitrary object thrown by a driver may carry a
 * connection string, and §7 keeps those out of logs by never handing one over.
 */
function describeThrown(value: unknown): string {
  switch (typeof value) {
    case 'string':
      return value;
    case 'number':
    case 'boolean':
    case 'bigint':
      return String(value);
    default:
      return 'unknown error';
  }
}

export function describeErrorChain(error: unknown): string {
  const parts: string[] = [];
  const seen = new Set<unknown>();
  let current = error;

  for (let depth = 0; depth < MAX_DEPTH; depth += 1) {
    if (current === undefined || current === null) break;

    // A cause that points back into the chain would otherwise spin here — in
    // the very code that is reporting a failure.
    if (seen.has(current)) break;
    seen.add(current);

    if (!(current instanceof Error)) {
      parts.push(describeThrown(current));
      break;
    }

    parts.push(`${current.name}: ${current.message}`);
    current = current.cause;
  }

  return parts.length === 0 ? 'unknown error' : parts.join(' ← ');
}
