/**
 * What the ephemeral-branch job decides, decided without a network (J1-11).
 *
 * The integration layer of CLAUDE.md §5 runs against "une branche Neon
 * éphémère" — a throwaway copy-on-write clone of the project's default branch,
 * created for one CI run and deleted with it. Nothing else in this repository
 * may point a test at production (§7).
 *
 * Everything here is pure, and that is not a stylistic preference: the API key
 * is a repository secret, so a cloud session can never exercise the transport.
 * The rules that could delete the wrong branch, or hand a job a connection
 * string pointing at the wrong host, are therefore kept where a unit test can
 * reach them.
 */

/**
 * Every branch this repository creates starts with it, and the pruner deletes
 * on it alone. It is the whole safety argument of `selectStaleBranches`, so it
 * is declared once and exported rather than spelled out at two call sites.
 */
export const EPHEMERAL_BRANCH_PREFIX = 'ci-';

/** The longest name we will build. Neon allows 256; a console shows far less. */
const MAX_NAME_LENGTH = 63;

/** The fields of a Neon branch this module reasons about. */
export interface NeonBranchSummary {
  readonly id: string;
  readonly name: string;
  /** RFC 3339, as the API returns it. Parsed here, never trusted. */
  readonly created_at: string;
  readonly default: boolean;
  readonly protected: boolean;
}

export interface StaleBranchOptions {
  readonly now: Date;
  readonly maxAgeMs: number;
}

export interface NeonProjectSummary {
  readonly id: string;
  readonly name: string;
}

export interface NeonOrganizationSummary {
  readonly id: string;
  readonly name: string;
}

/** Lowercase, `[a-z0-9-]`, no leading, trailing or doubled separator. */
function sanitize(part: string): string {
  return part
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * The name of the branch of one CI run.
 *
 * The parts come from the workflow context — the pull request or ref, the run
 * id, the attempt — and are sanitised rather than validated: a ref name may
 * hold slashes, dots and accents, all of which Neon accepts and no human can
 * type back into a console when something has to be cleaned up by hand.
 */
export function ephemeralBranchName(parts: readonly string[]): string {
  const kept = parts.map(sanitize).filter((part) => part !== '');

  if (kept.length === 0) {
    // A bare `ci-` would match the prune filter, so the next run could delete
    // the branch this one is using. Refusing is the cheap half of that bug.
    throw new Error(
      'An ephemeral branch name needs at least one usable part ' +
        '(the pull request or ref, and the run id).',
    );
  }

  return `${EPHEMERAL_BRANCH_PREFIX}${kept.join('-')}`
    .slice(0, MAX_NAME_LENGTH)
    .replace(/-+$/g, '');
}

/** True for a name this repository built, false for anything a human named. */
export function isEphemeralBranchName(name: string): boolean {
  return name.startsWith(EPHEMERAL_BRANCH_PREFIX);
}

/**
 * The branches a run may delete on sight, oldest first.
 *
 * It exists because of a limit rather than for tidiness: a Neon project caps
 * how many branches it may hold, so a handful of runs killed mid-flight —
 * cancelled by `concurrency`, or by a runner outage — is enough to make every
 * later run fail at creation. The cleanup step of the workflow is the normal
 * path; this is what makes the abnormal one self-healing.
 *
 * Three guards, and each of them protects the same thing:
 *
 *  - only names this repository builds (`ci-`);
 *  - never the default branch, nor a protected one, whatever they are called;
 *  - never a branch younger than the allowance — that one belongs to a run in
 *    flight, and killing it would fail a pull request for a reason foreign to
 *    its diff (CLAUDE.md §5).
 */
export function selectStaleBranches(
  branches: readonly NeonBranchSummary[],
  options: StaleBranchOptions,
): readonly NeonBranchSummary[] {
  const cutoff = options.now.getTime() - options.maxAgeMs;

  return (
    branches
      .filter((branch) => isEphemeralBranchName(branch.name))
      .filter((branch) => !branch.default && !branch.protected)
      .map((branch) => ({ branch, createdAt: Date.parse(branch.created_at) }))
      // An unreadable date is an unknown age, and an unknown age is not an old
      // age: `NaN < cutoff` is false, but saying so out loud beats relying on it.
      .filter((entry) => !Number.isNaN(entry.createdAt) && entry.createdAt < cutoff)
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((entry) => entry.branch)
  );
}

/**
 * The pooled form of a Neon connection string.
 *
 * The site connects through the pooled endpoint and the migrations through the
 * direct one (CLAUDE.md §9), so an ephemeral branch has to offer both or the
 * CI job would exercise a shape production never runs. Neon reports
 * `pooler_host` on branch creation; the fallback derives it from the direct
 * host, which is the convention §9 already writes down — the direct host is
 * the one "sans le suffixe `-pooler`".
 */
export function pooledConnectionUri(directUri: string, poolerHost?: string): string {
  let url: URL;

  try {
    url = new URL(directUri);
  } catch {
    // The value is a credential, so it never reaches the message — here or in
    // a log (CLAUDE.md §7).
    throw new Error('The Neon connection string could not be parsed as a URI.');
  }

  if (poolerHost !== undefined && poolerHost !== '') {
    url.hostname = poolerHost;
    return url.href;
  }

  const host = url.hostname;

  // Empty, or starting on a dot: there is no first label to suffix. Written as
  // one predicate rather than two so the guard has one reachable failing case
  // and not a second nothing could ever produce (docs/roadmap.md, "branches
  // défensives et couverture").
  if (!/^[^.]/.test(host)) {
    throw new Error('The Neon connection string carries no host to derive a pooled one from.');
  }

  if (/^[^.]*-pooler/.test(host)) return url.href;

  url.hostname = host.replace(/^[^.]*/, '$&-pooler');
  return url.href;
}

/**
 * The project the API key may act on, when nothing said which.
 *
 * `NEON_API_KEY` is scoped to an account rather than to a project — a point
 * docs/roadmap.md has carried as debt since 4 August — so "the only project"
 * is an observation about today, not a guarantee. It is checked rather than
 * assumed: taking the first of several would create branches, and run
 * migrations, against somebody else's database.
 */
export function selectProjectId(projects: readonly NeonProjectSummary[]): string {
  const [only] = projects;

  if (only === undefined) {
    throw new Error(
      'The Neon API key can see no project. Check that NEON_API_KEY is set and still valid.',
    );
  }

  if (projects.length > 1) {
    throw new Error(
      'The Neon API key can see several projects, so this job will not guess which one to ' +
        'branch. Set the NEON_PROJECT_ID variable (CLAUDE.md §9) to one of: ' +
        `${projects.map((project) => `${project.id} (${project.name})`).join(', ')}.`,
    );
  }

  return only.id;
}

/**
 * The organisation whose projects the key may list.
 *
 * This function exists because the first real CI run said so. `GET /projects`
 * came back `400: org_id is required, you can find it on your organization
 * settings page`: the account behind `NEON_API_KEY` belongs to an
 * organisation, and Neon then refuses to guess which account a bare project
 * listing means. The OpenAPI specification calls `org_id` an optional filter
 * and says nothing about when it stops being optional — which is exactly the
 * gap docs/roadmap.md had recorded as "le job Neon n'a jamais parlé à Neon".
 *
 * Same discipline as `selectProjectId`, for the same reason: picking the first
 * of several would act on somebody else's account.
 */
export function selectOrganizationId(organizations: readonly NeonOrganizationSummary[]): string {
  const [only] = organizations;

  if (only === undefined) {
    throw new Error(
      'The Neon API key belongs to no organisation, yet Neon asked for one. ' +
        'Set the NEON_PROJECT_ID variable (CLAUDE.md §9) to skip this lookup entirely.',
    );
  }

  if (organizations.length > 1) {
    throw new Error(
      'The Neon API key can see several organisations, so this job will not guess which one ' +
        'to list projects from. Set the NEON_PROJECT_ID variable (CLAUDE.md §9) to skip this ' +
        `lookup entirely. Seen: ${organizations.map((org) => `${org.id} (${org.name})`).join(', ')}.`,
    );
  }

  return only.id;
}
