import { describe, expect, it } from 'vitest';
import { parseJournal } from './journal.js';

/**
 * drizzle/meta/_journal.json is written by drizzle-kit, so it is a file we read
 * and never a file we control — the §4 rule about external data applies to a
 * tool's output as much as to an API's. The fixture below is the repository's
 * own journal, copied verbatim.
 */
const REAL_JOURNAL = {
  version: '7',
  dialect: 'postgresql',
  entries: [
    {
      idx: 0,
      version: '7',
      when: 1_786_029_350_888,
      tag: '0000_married_whistler',
      breakpoints: true,
    },
    {
      idx: 1,
      version: '7',
      when: 1_786_033_672_933,
      tag: '0001_cloudy_doctor_doom',
      breakpoints: true,
    },
  ],
};

describe('parseJournal', () => {
  it('reads the entries of the real journal', () => {
    expect(parseJournal(REAL_JOURNAL)).toEqual([
      { idx: 0, when: 1_786_029_350_888, tag: '0000_married_whistler' },
      { idx: 1, when: 1_786_033_672_933, tag: '0001_cloudy_doctor_doom' },
    ]);
  });

  it('keeps only what the plan needs, ignoring the rest', () => {
    // `version` and `breakpoints` belong to drizzle-kit. Carrying them would
    // make this module fail the day drizzle-kit adds a field.
    const [first] = parseJournal(REAL_JOURNAL);

    expect(Object.keys(first ?? {}).sort()).toEqual(['idx', 'tag', 'when']);
  });

  it('accepts a journal with no entry at all', () => {
    expect(parseJournal({ version: '7', dialect: 'postgresql', entries: [] })).toEqual([]);
  });

  it('refuses a journal whose shape changed', () => {
    // The failure this exists to force: drizzle-kit renames a field, the plan
    // silently sees zero migrations, and a run reports "nothing to do" on a
    // database that needs everything.
    expect(() => parseJournal({ version: '7', entries: [{ idx: 0, tag: 'x' }] })).toThrow();
    expect(() => parseJournal({})).toThrow();
    expect(() => parseJournal(null)).toThrow();
  });
});
