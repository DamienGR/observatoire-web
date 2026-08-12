import { describe, expect, it } from 'vitest';
import {
  EPHEMERAL_BRANCH_PREFIX,
  ephemeralBranchName,
  isEphemeralBranchName,
  pooledConnectionUri,
  selectOrganizationId,
  selectProjectId,
  selectStaleBranches,
  type NeonBranchSummary,
} from './branch.js';

/**
 * Written before `branch.ts` (CLAUDE.md §5: test-first for pure logic).
 *
 * Everything the ephemeral-branch job decides lives here, so it can be decided
 * without an API key — which matters more than usual, because `NEON_API_KEY` is
 * a repository secret no session can read. The half that talks to Neon is a
 * transport; the half that could delete the wrong branch is this file.
 */

function branch(overrides: Partial<NeonBranchSummary> = {}): NeonBranchSummary {
  return {
    id: 'br-holy-grail-123456',
    name: 'ci-pr-42-1000-1',
    created_at: '2026-08-12T09:00:00Z',
    default: false,
    protected: false,
    ...overrides,
  };
}

describe('ephemeralBranchName', () => {
  it('prefixes every name it builds, which is what makes pruning safe', () => {
    // The prefix is the only thing standing between the pruner and the
    // production branch: `selectStaleBranches` deletes on it.
    expect(ephemeralBranchName(['pr-42', '1000', '1'])).toBe('ci-pr-42-1000-1');
    expect(ephemeralBranchName(['pr-42', '1000', '1']).startsWith(EPHEMERAL_BRANCH_PREFIX)).toBe(
      true,
    );
  });

  it('lowercases and strips whatever a ref name may carry', () => {
    // Branch names reach this from `github.ref_name`, which accepts slashes,
    // dots and accents. Neon takes them, but a name nobody can type into a
    // console is a name nobody can clean up by hand.
    expect(ephemeralBranchName(['feat/Ephemeral Branch', '7'])).toBe('ci-feat-ephemeral-branch-7');
  });

  it('collapses the separators its own sanitising produces', () => {
    expect(ephemeralBranchName(['a//b', '_ _', '3'])).toBe('ci-a-b-3');
  });

  it('drops parts that sanitise down to nothing rather than emit `--`', () => {
    expect(ephemeralBranchName(['', 'pr-9', '  ', '2'])).toBe('ci-pr-9-2');
  });

  it('caps the length, because a Neon name is bounded and a run id is not', () => {
    const name = ephemeralBranchName(['x'.repeat(200), '1']);

    expect(name.length).toBeLessThanOrEqual(63);
    expect(name.endsWith('-')).toBe(false);
  });

  it('refuses to build a name out of nothing', () => {
    // A bare `ci-` would match the prune filter and could then be deleted by
    // the next run. Failing here beats a branch that deletes itself.
    expect(() => ephemeralBranchName([])).toThrow(/at least one/i);
    expect(() => ephemeralBranchName(['///', '   '])).toThrow(/at least one/i);
  });
});

describe('isEphemeralBranchName', () => {
  it('recognises what this repository creates and nothing else', () => {
    expect(isEphemeralBranchName('ci-pr-42-1000-1')).toBe(true);
    expect(isEphemeralBranchName('main')).toBe(false);
    expect(isEphemeralBranchName('production')).toBe(false);
    // Near misses matter: a human branch called `city-data` must survive.
    expect(isEphemeralBranchName('city-data')).toBe(false);
    expect(isEphemeralBranchName('CI-PR-42')).toBe(false);
  });
});

describe('selectStaleBranches', () => {
  const now = new Date('2026-08-12T12:00:00Z');
  const maxAgeMs = 2 * 60 * 60 * 1000;

  it('selects an ephemeral branch older than the allowance', () => {
    const stale = branch({ id: 'br-old', created_at: '2026-08-12T09:00:00Z' });

    expect(selectStaleBranches([stale], { now, maxAgeMs })).toEqual([stale]);
  });

  it('leaves a young ephemeral branch alone — it belongs to a run in flight', () => {
    // Two pull requests build at once. Deleting the neighbour's branch would
    // fail its run for a reason foreign to its diff (CLAUDE.md §5).
    const young = branch({ created_at: '2026-08-12T11:30:00Z' });

    expect(selectStaleBranches([young], { now, maxAgeMs })).toEqual([]);
  });

  it('never touches a branch this repository did not name', () => {
    const production = branch({ id: 'br-prod', name: 'main', created_at: '2025-01-01T00:00:00Z' });

    expect(selectStaleBranches([production], { now, maxAgeMs })).toEqual([]);
  });

  it('never touches the default branch, whatever it is called', () => {
    // Belt and braces. If production were ever renamed into the prefix, the
    // age test alone would hand it to a `DELETE`.
    const misnamed = branch({
      name: 'ci-legacy-import',
      default: true,
      created_at: '2025-01-01T00:00:00Z',
    });

    expect(selectStaleBranches([misnamed], { now, maxAgeMs })).toEqual([]);
  });

  it('never touches a protected branch either', () => {
    const guarded = branch({
      name: 'ci-legacy-import',
      protected: true,
      created_at: '2025-01-01T00:00:00Z',
    });

    expect(selectStaleBranches([guarded], { now, maxAgeMs })).toEqual([]);
  });

  it('ignores a branch whose creation date it cannot read', () => {
    // An unparseable date means an unknown age, and an unknown age is not an
    // old age. Silence beats deleting on a `NaN`.
    const undated = branch({ created_at: 'not a date' });

    expect(selectStaleBranches([undated], { now, maxAgeMs })).toEqual([]);
  });

  it('sorts the oldest first, so a run against a full project frees room', () => {
    const older = branch({ id: 'br-older', created_at: '2026-08-12T06:00:00Z' });
    const old = branch({ id: 'br-old', created_at: '2026-08-12T08:00:00Z' });

    expect(selectStaleBranches([old, older], { now, maxAgeMs }).map((entry) => entry.id)).toEqual([
      'br-older',
      'br-old',
    ]);
  });
});

describe('pooledConnectionUri', () => {
  const direct =
    'postgresql://neondb_owner:npg_secret@ep-cool-name-a1.eu-central-1.aws.neon.tech/neondb?sslmode=require';

  it('swaps in the pooler host Neon reports, and changes nothing else', () => {
    const pooled = pooledConnectionUri(direct, 'ep-cool-name-a1-pooler.eu-central-1.aws.neon.tech');

    expect(pooled).toBe(
      'postgresql://neondb_owner:npg_secret@ep-cool-name-a1-pooler.eu-central-1.aws.neon.tech/neondb?sslmode=require',
    );
  });

  it('derives the pooler host when the API does not report one', () => {
    // CLAUDE.md §9 already states the convention — the direct host is the one
    // "sans le suffixe `-pooler`" — so the fallback encodes a rule the
    // repository relies on elsewhere rather than inventing one.
    expect(pooledConnectionUri(direct)).toBe(
      'postgresql://neondb_owner:npg_secret@ep-cool-name-a1-pooler.eu-central-1.aws.neon.tech/neondb?sslmode=require',
    );
  });

  it('leaves an already pooled URI alone instead of doubling the suffix', () => {
    const pooled = pooledConnectionUri(direct, 'ep-cool-name-a1-pooler.eu-central-1.aws.neon.tech');

    expect(pooledConnectionUri(pooled)).toBe(pooled);
  });

  it('preserves a percent-encoded password character for character', () => {
    // The whole value is a credential: a re-encoding that looks harmless is an
    // authentication failure nobody can attribute.
    const encoded = 'postgresql://role:p%40ss%2Fword@ep-x.aws.neon.tech/neondb';

    expect(pooledConnectionUri(encoded)).toContain('p%40ss%2Fword');
  });

  it('refuses a connection string it cannot parse', () => {
    expect(() => pooledConnectionUri('not a uri')).toThrow(/connection/i);
  });

  it('refuses a host with no label to suffix', () => {
    expect(() => pooledConnectionUri('postgresql:///neondb')).toThrow(/host/i);
  });
});

describe('selectProjectId', () => {
  it('takes the only project the key can see', () => {
    expect(selectProjectId([{ id: 'shiny-wind-028834', name: 'observatoire-web' }])).toBe(
      'shiny-wind-028834',
    );
  });

  it('refuses to guess between several, and names them', () => {
    // The alternative — "take the first" — would migrate somebody else's
    // database on the day a second project appears.
    expect(() =>
      selectProjectId([
        { id: 'a-1', name: 'observatoire-web' },
        { id: 'b-2', name: 'scratch' },
      ]),
    ).toThrow(/NEON_PROJECT_ID/);
    expect(() =>
      selectProjectId([
        { id: 'a-1', name: 'observatoire-web' },
        { id: 'b-2', name: 'scratch' },
      ]),
    ).toThrow(/a-1|b-2/);
  });

  it('says the key sees nothing rather than fail one call later', () => {
    expect(() => selectProjectId([])).toThrow(/no project/i);
  });
});

describe('selectOrganizationId', () => {
  /**
   * Added after the first real CI run, not before it. `GET /projects` answered
   * `400: org_id is required, you can find it on your organization settings
   * page` — the account behind `NEON_API_KEY` belongs to an organisation, and
   * Neon refuses to guess which account a bare project listing means. The
   * OpenAPI specification says `org_id` is an optional filter; it does not say
   * when it stops being optional (docs/journal.md 022).
   */
  it('takes the only organisation the key can see', () => {
    expect(selectOrganizationId([{ id: 'org-cool-frog-12345678', name: 'DG-Tech' }])).toBe(
      'org-cool-frog-12345678',
    );
  });

  it('refuses to guess between several, and points at the way out', () => {
    expect(() =>
      selectOrganizationId([
        { id: 'org-a', name: 'DG-Tech' },
        { id: 'org-b', name: 'Autre' },
      ]),
    ).toThrow(/NEON_PROJECT_ID/);
  });

  it('says the key belongs to no organisation rather than send an empty filter', () => {
    // A `?org_id=` with nothing after it is a request that asks a different
    // question, and gets an answer nobody can attribute.
    expect(() => selectOrganizationId([])).toThrow(/no organisation/i);
  });
});
