import { describe, expect, it } from 'vitest';
import { STATUTS_RESOLUTION, type StatutResolution } from '../../db/schema.js';
import { isScannable, selectScanTargets, type ScanCandidate } from './eligibility.js';

const candidate = (overrides: Partial<ScanCandidate> & { siteId: number }): ScanCandidate => ({
  communeId: '56121',
  url: 'https://example.invalid/',
  statutResolution: 'verifie',
  population: 10_000,
  ...overrides,
});

describe('isScannable', () => {
  it.each([
    ['verifie', true],
    ['candidat', false],
    ['invalide', false],
    ['a_revoir', false],
  ] as const)('%s → %s', (statut, expected) => {
    expect(isScannable(statut)).toBe(expected);
  });

  it('has an opinion about every state the column can hold', () => {
    // A state added to the schema without being taught here would otherwise
    // become silently unscannable, which is the failure nobody notices.
    for (const statut of STATUTS_RESOLUTION) {
      expect(typeof isScannable(statut satisfies StatutResolution)).toBe('boolean');
    }
  });
});

describe('selectScanTargets', () => {
  it('measures nothing when nothing is verified', () => {
    const selection = selectScanTargets([
      candidate({ siteId: 1, statutResolution: 'candidat' }),
      candidate({ siteId: 2, statutResolution: 'a_revoir', communeId: '35238' }),
    ]);

    expect(selection.selected).toEqual([]);
    // Reported in sample order, not in the order the rows arrived: the refusals
    // have to be as reproducible as the selection, or two identical runs
    // produce two different logs.
    expect(selection.skipped).toEqual([
      { siteId: 2, communeId: '35238', reason: 'unverified-url' },
      { siteId: 1, communeId: '56121', reason: 'unverified-url' },
    ]);
  });

  it('orders by population, most populous first', () => {
    const selection = selectScanTargets([
      candidate({ siteId: 1, communeId: '56121', population: 57_000 }),
      candidate({ siteId: 2, communeId: '35238', population: 220_000 }),
      candidate({ siteId: 3, communeId: '29019', population: 140_000 }),
    ]);

    expect(selection.selected.map((site) => site.siteId)).toEqual([2, 3, 1]);
  });

  it('breaks a population tie by INSEE code, so two runs plan the same sample', () => {
    const selection = selectScanTargets([
      candidate({ siteId: 7, communeId: '56121', population: 12_000 }),
      candidate({ siteId: 8, communeId: '29019', population: 12_000 }),
    ]);

    expect(selection.selected.map((site) => site.communeId)).toEqual(['29019', '56121']);
  });

  it('sorts three tied communes by INSEE code, not just two', () => {
    // Two elements are sorted by a single comparison, which a comparator
    // answering the same thing every time can still get right by accident.
    // Three cannot.
    const selection = selectScanTargets([
      candidate({ siteId: 1, communeId: '56121', population: 12_000 }),
      candidate({ siteId: 2, communeId: '22278', population: 12_000 }),
      candidate({ siteId: 3, communeId: '29019', population: 12_000 }),
    ]);

    expect(selection.selected.map((site) => site.communeId)).toEqual(['22278', '29019', '56121']);
  });

  it('keeps one site per commune and says which one it dropped', () => {
    const selection = selectScanTargets([
      candidate({ siteId: 5, communeId: '56121' }),
      candidate({ siteId: 4, communeId: '56121', url: 'https://other.invalid/' }),
    ]);

    expect(selection.selected.map((site) => site.siteId)).toEqual([4]);
    expect(selection.skipped).toEqual([
      { siteId: 5, communeId: '56121', reason: 'commune-already-covered' },
    ]);
  });

  it('cuts the sample to the requested size, without listing what it left out', () => {
    const selection = selectScanTargets(
      [
        candidate({ siteId: 1, communeId: '35238', population: 220_000 }),
        candidate({ siteId: 2, communeId: '29019', population: 140_000 }),
        candidate({ siteId: 3, communeId: '56121', population: 57_000 }),
      ],
      { limit: 2 },
    );

    expect(selection.selected.map((site) => site.siteId)).toEqual([1, 2]);
    expect(selection.skipped).toEqual([]);
    expect(selection.report.outsideSample).toBe(1);
  });

  it('takes everything when the limit is larger than the perimeter', () => {
    const selection = selectScanTargets([candidate({ siteId: 1 })], { limit: 20 });

    expect(selection.selected).toHaveLength(1);
    expect(selection.report.outsideSample).toBe(0);
  });

  it('selects nothing at all when asked for a sample of zero', () => {
    const selection = selectScanTargets([candidate({ siteId: 1 })], { limit: 0 });

    expect(selection.selected).toEqual([]);
    expect(selection.report.outsideSample).toBe(1);
  });

  it('restricts the sample to the communes it is given, when it is given some', () => {
    const selection = selectScanTargets(
      [
        candidate({ siteId: 1, communeId: '35238', population: 220_000 }),
        candidate({ siteId: 2, communeId: '29019', population: 140_000 }),
      ],
      { communes: ['29019'] },
    );

    expect(selection.selected.map((site) => site.siteId)).toEqual([2]);
    expect(selection.skipped).toEqual([
      { siteId: 1, communeId: '35238', reason: 'outside-requested-communes' },
    ]);
  });

  it('counts what it looked at, kept and refused', () => {
    const selection = selectScanTargets(
      [
        candidate({ siteId: 1, communeId: '35238', population: 220_000 }),
        candidate({
          siteId: 2,
          communeId: '35238',
          population: 220_000,
          url: 'https://b.invalid/',
        }),
        candidate({ siteId: 3, communeId: '29019', statutResolution: 'invalide' }),
        candidate({ siteId: 4, communeId: '56121', population: 57_000 }),
      ],
      { limit: 1 },
    );

    expect(selection.report).toEqual({
      sitesConsidered: 4,
      communesTargeted: 1,
      outsideSample: 1,
      skipped: 2,
    });
  });

  it('is not fooled by an unsorted input into dropping the populous duplicate', () => {
    // The commune is kept once; the survivor must be the first in the ordering,
    // not the first in the array.
    const selection = selectScanTargets([
      candidate({ siteId: 9, communeId: '35238', population: 220_000 }),
      candidate({ siteId: 2, communeId: '35238', population: 220_000 }),
    ]);

    expect(selection.selected.map((site) => site.siteId)).toEqual([2]);
  });

  it('does not mutate the array it was given', () => {
    const sites = [
      candidate({ siteId: 1, communeId: '56121', population: 10_000 }),
      candidate({ siteId: 2, communeId: '35238', population: 220_000 }),
    ];

    selectScanTargets(sites);

    expect(sites.map((site) => site.siteId)).toEqual([1, 2]);
  });
});
