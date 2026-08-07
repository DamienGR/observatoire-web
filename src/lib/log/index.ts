/**
 * The application logger CLAUDE.md §4 asks for when it forbids `console.log`.
 *
 * It exists because the ingestion job (J1-14) is the first thing in this
 * repository whose output somebody actually reads: from a cloud-only session,
 * a workflow log and an uploaded artefact are the only window on a job that
 * ran somewhere else. So the format is one JSON object per line — greppable in
 * the Actions viewer, and parseable by whatever reads the artefact later —
 * rather than prose that looks nicer and cannot be queried.
 *
 * Deliberately not a dependency. What a job needs is a timestamp, a level, a
 * message and a bag of numbers; a logging framework would bring transports,
 * formatters and a configuration file for that.
 *
 * Nothing here scrubs secrets, and that is a decision rather than an omission:
 * a scrubber invites callers to pass whatever they have and trust the filter.
 * The rule stays where §7 puts it — a connection string is never handed to a
 * logger in the first place.
 */

export type LogLevel = 'info' | 'warn' | 'error';

export interface LogEntry {
  readonly level: LogLevel;
  readonly message: string;
  readonly fields?: Readonly<Record<string, unknown>>;
}

export type LogSink = (line: string) => void;

export interface Logger {
  info(message: string, fields?: Readonly<Record<string, unknown>>): void;
  warn(message: string, fields?: Readonly<Record<string, unknown>>): void;
  error(message: string, fields?: Readonly<Record<string, unknown>>): void;
}

export interface LoggerOptions {
  readonly sink: LogSink;
  /** Injected so a test can assert on the timestamp rather than ignore it. */
  readonly now?: () => Date;
}

/**
 * One line of NDJSON.
 *
 * The envelope is written *after* the fields so a caller cannot shadow `level`
 * or `at` with a field of the same name — a log that lies about its own level
 * is worse than a log missing a field.
 */
export function formatEntry(entry: LogEntry, at: Date): string {
  const payload = {
    ...entry.fields,
    at: at.toISOString(),
    level: entry.level,
    message: entry.message,
  };

  try {
    return JSON.stringify(payload);
  } catch {
    // A value JSON refuses — a BigInt, a cycle — must not take the job down
    // with it, least of all while it is reporting a failure.
    return JSON.stringify({
      at: at.toISOString(),
      level: entry.level,
      message: entry.message,
      fieldsDropped: true,
    });
  }
}

export function createLogger(options: LoggerOptions): Logger {
  const now = options.now ?? ((): Date => new Date());

  const emit = (level: LogLevel, message: string, fields?: Readonly<Record<string, unknown>>) => {
    options.sink(
      formatEntry(fields === undefined ? { level, message } : { level, message, fields }, now()),
    );
  };

  return {
    info: (message, fields) => {
      emit('info', message, fields);
    },
    warn: (message, fields) => {
      emit('warn', message, fields);
    },
    error: (message, fields) => {
      emit('error', message, fields);
    },
  };
}
