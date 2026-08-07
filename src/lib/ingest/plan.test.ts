import { describe, expect, it } from 'vitest';
import type { AnnuaireRecord } from '../sources/annuaire.js';
import type { CommuneRecord } from '../sources/geo.js';
import { buildIngestionPlan } from './plan.js';

/**
 * Written before `plan.ts`. What the plan reports is what the operator will
 * read in the workflow log — the only window a cloud-only session has on a job
 * — so the report is tested like a feature, not like a debug trace.
 */
function commune(codeInsee: string, population: number | null): CommuneRecord {
  return {
    codeInsee,
    nom: `Commune ${codeInsee}`,
    population,
    departement: '01',
    region: '84',
    epci: null,
  };
}

function mairie(codeInsee: string, urls: readonly string[]): AnnuaireRecord {
  return {
    id: `id-${codeInsee}-${String(urls.length)}`,
    nom: `Mairie - ${codeInsee}`,
    codeInsee,
    pivots: [{ typeServiceLocal: 'mairie', codesInsee: [codeInsee] }],
    urls,
    published: true,
    modifiedAt: null,
  };
}

const communes = [
  commune('01004', 15_934),
  commune('01001', 785),
  commune('75056', 2_133_111),
  commune('98411', null),
];

const annuaire = [
  mairie('01004', ['https://ville-01004.fr/']),
  mairie('01001', ['https://ville-01001.fr/']),
  // 75056 has a town hall record with no website at all.
  mairie('75056', []),
];

const plan = buildIngestionPlan({ communes, annuaire });

describe('buildIngestionPlan', () => {
  it('plans one row per commune of the perimeter', () => {
    expect(plan.communes.map((entry) => entry.codeInsee)).toEqual(['01004', '75056']);
  });

  it('plans a site row for every candidate of every commune in the perimeter', () => {
    expect(plan.sites).toEqual([
      { communeId: '01004', url: 'https://ville-01004.fr/', source: 'annuaire' },
    ]);
  });

  it('plans nothing for a commune outside the perimeter, even with a website', () => {
    // The directory covers 35 732 communes; we measure 1 067. Ingesting the
    // rest would be storing what we will never scan.
    expect(plan.sites.some((site) => site.communeId === '01001')).toBe(false);
  });

  it('reports what was seen and what was kept', () => {
    expect(plan.report.communesSeen).toBe(4);
    expect(plan.report.communesInPerimeter).toBe(2);
    expect(plan.report.mairieRecords).toBe(3);
    expect(plan.report.populationThreshold).toBe(10_000);
  });

  it('names the communes it could not propose a single URL for', () => {
    // The number that matters operationally: 15 communes of the real perimeter
    // are in this case, and they are the ones needing a manual URL. A count
    // alone would say "15" without ever saying which.
    expect(plan.report.communesWithoutCandidate).toEqual(['75056']);
  });

  it('counts the communes carrying more than one candidate', () => {
    // 138 on the real data. It is the size of the queue J1-06 will have to
    // arbitrate, and knowing it before writing that state machine is the point.
    const several = buildIngestionPlan({
      communes: [commune('01004', 15_934)],
      annuaire: [mairie('01004', ['https://a.fr/', 'https://b.fr/'])],
    });

    expect(several.report.communesWithSeveralCandidates).toBe(1);
    expect(several.report.candidateUrls).toBe(2);
  });

  it('accepts a threshold, and reports the one it used', () => {
    const wider = buildIngestionPlan({ communes, annuaire, threshold: 500 });

    expect(wider.report.populationThreshold).toBe(500);
    expect(wider.report.communesInPerimeter).toBe(3);
  });

  it('produces the same plan twice on the same input', () => {
    // Idempotence starts here: two runs on the same referential must not even
    // *plan* different things, or no comparison downstream means anything.
    expect(buildIngestionPlan({ communes, annuaire })).toEqual(plan);
  });
});
