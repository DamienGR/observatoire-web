import { describe, expect, it } from 'vitest';
import { createLogger, formatEntry, type LogLevel } from './index.js';

interface LogLine {
  readonly level: LogLevel;
}

/**
 * Written before `index.ts`. CLAUDE.md §4 forbids `console.log` outside
 * development scripts and points at "le logger applicatif", which did not
 * exist until the first job needed one — a job whose entire output is what an
 * operator reads in a workflow log.
 */
describe('formatEntry', () => {
  it('writes one JSON object per line', () => {
    const line = formatEntry(
      { level: 'info', message: 'ingestion started' },
      new Date('2026-08-07T10:00:00Z'),
    );

    expect(JSON.parse(line)).toEqual({
      at: '2026-08-07T10:00:00.000Z',
      level: 'info',
      message: 'ingestion started',
    });
    expect(line).not.toContain('\n');
  });

  it('timestamps in UTC', () => {
    // CLAUDE.md §4: stored and manipulated in UTC, formatted in Europe/Paris
    // only for display. A log line is not display.
    expect(
      formatEntry({ level: 'info', message: 'x' }, new Date('2026-08-07T10:00:00Z')),
    ).toContain('2026-08-07T10:00:00.000Z');
  });

  it('merges fields into the object rather than stringifying them', () => {
    const line = formatEntry(
      { level: 'info', message: 'plan', fields: { communes: 1067, sites: 1224 } },
      new Date('2026-08-07T10:00:00Z'),
    );

    expect(JSON.parse(line)).toMatchObject({ communes: 1067, sites: 1224 });
  });

  it('keeps a field from overwriting the envelope', () => {
    const line = formatEntry(
      { level: 'info', message: 'plan', fields: { level: 'error', at: 'yesterday' } },
      new Date('2026-08-07T10:00:00Z'),
    );

    expect(JSON.parse(line)).toMatchObject({ level: 'info', at: '2026-08-07T10:00:00.000Z' });
  });

  it('survives a value JSON cannot serialise', () => {
    // A job that crashes while reporting a crash tells nobody anything.
    const line = formatEntry(
      { level: 'error', message: 'boom', fields: { size: 10n } },
      new Date('2026-08-07T10:00:00Z'),
    );

    expect(JSON.parse(line)).toMatchObject({ level: 'error', message: 'boom' });
  });
});

describe('createLogger', () => {
  it('sends every level to the sink', () => {
    const lines: string[] = [];
    const logger = createLogger({ sink: (line) => lines.push(line), now: () => new Date(0) });

    logger.info('one');
    logger.warn('two');
    logger.error('three');

    expect(lines.map((line) => (JSON.parse(line) as LogLine).level)).toEqual([
      'info',
      'warn',
      'error',
    ]);
  });

  it('carries the fields given at each call', () => {
    const lines: string[] = [];
    const logger = createLogger({ sink: (line) => lines.push(line), now: () => new Date(0) });

    logger.info('planned', { communes: 1067 });

    expect(JSON.parse(lines[0] ?? '{}')).toMatchObject({ message: 'planned', communes: 1067 });
  });
});
