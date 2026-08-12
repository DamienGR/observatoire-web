import { z } from 'zod';
import {
  pooledConnectionUri,
  type NeonBranchSummary,
  type NeonOrganizationSummary,
  type NeonProjectSummary,
} from './branch.js';

/**
 * The Neon management API, as much of it as J1-11 needs: list, create, wait,
 * delete.
 *
 * Plain `fetch` rather than the guarded client of `src/lib/fetch/`, and the
 * distinction is the one `src/lib/ingest/referentials.ts` already draws: that
 * guard exists for URLs a third party hands us. This host is written down here
 * and it is the API that holds our own infrastructure.
 *
 * The transport arrives by injection because the alternative is no test at all.
 * `NEON_API_KEY` is a repository secret (CLAUDE.md §9), so a cloud session
 * cannot run a single one of these calls for real — the retry policy, the
 * parsing and the failure modes are knowable here or nowhere.
 */

const DEFAULT_BASE_URL = 'https://console.neon.tech/api/v2';

/** Four attempts, then give up. Same policy as the referential downloads. */
const ATTEMPTS = 4;
const BACKOFF_MS = [1_000, 2_000, 4_000];

/** A management call is small; only an outage takes this long. */
const REQUEST_TIMEOUT_MS = 30_000;

/** How long a branch may take to report itself ready, at one second a look. */
const READY_ATTEMPTS = 30;
const READY_INTERVAL_MS = 1_000;

/** Whatever the API says about a failure, capped so a log stays a log. */
const MAX_API_MESSAGE_LENGTH = 200;

export interface NeonApiDeps {
  readonly fetch: typeof fetch;
  /** Injected so backoff can be asserted without waiting for it. */
  readonly wait?: (ms: number) => Promise<void>;
}

export interface NeonClientOptions {
  readonly apiKey: string;
  readonly baseUrl?: string;
}

/**
 * The API answered, and said no. Not retried: a 4xx is our mistake — a bad
 * key, a name already taken, a branch limit reached — and asking again asks
 * the same wrong question.
 */
export class NeonApiError extends Error {
  override readonly name = 'NeonApiError';
  readonly status: number;

  constructor(method: string, path: string, status: number, detail: string) {
    super(
      `The Neon API rejected ${method} ${path} with HTTP ${String(status)}` +
        (detail === '' ? '.' : `: ${detail}`),
    );
    this.status = status;
  }
}

/** The API never answered. An outage, not a defect in what we asked for. */
export class NeonUnavailableError extends Error {
  override readonly name = 'NeonUnavailableError';

  constructor(method: string, path: string, attempts: number, lastError: string) {
    super(
      `The Neon API did not answer ${method} ${path} after ${String(attempts)} attempts ` +
        `(${lastError}). This is an availability failure, not a rejection.`,
    );
  }
}

/** The payload arrived and is not what the API documents. */
export class NeonResponseError extends Error {
  override readonly name = 'NeonResponseError';

  constructor(path: string, issues: readonly string[]) {
    super(
      `The Neon API answered ${path} with an unexpected shape:\n` +
        issues.map((issue) => `  - ${issue}`).join('\n'),
    );
  }
}

const projectSchema = z.object({ id: z.string().min(1), name: z.string().min(1) });
const projectsSchema = z.object({ projects: z.array(projectSchema) });

const organizationSchema = z.object({ id: z.string().min(1), name: z.string().min(1) });
const organizationsSchema = z.object({ organizations: z.array(organizationSchema) });

const branchSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  created_at: z.string().min(1),
  default: z.boolean(),
  protected: z.boolean(),
  current_state: z.string().min(1),
});
const branchesSchema = z.object({ branches: z.array(branchSchema) });

/**
 * `connection_uris` is optional in the spec, and the omission is documented
 * rather than accidental: the API leaves it out when the parent branch holds
 * more than one role or database. Optional here, named at the call site.
 */
const createdBranchSchema = z.object({
  branch: branchSchema,
  connection_uris: z
    .array(
      z.object({
        connection_uri: z.string().min(1),
        connection_parameters: z.object({ pooler_host: z.string().min(1).optional() }),
      }),
    )
    .optional(),
});

/** What the API says went wrong, when it bothers to say. */
const apiMessageSchema = z.object({ message: z.string() });

/** A Neon branch, with the state field only the readiness poll cares about. */
export type NeonBranch = NeonBranchSummary & { readonly current_state: string };

/** One throwaway database, in the two shapes CLAUDE.md §9 keeps apart. */
export interface EphemeralBranch {
  readonly id: string;
  readonly name: string;
  /** The direct endpoint. Migrations, and the ingestion's single transaction. */
  readonly directUri: string;
  /** The pooled endpoint. What the site itself would use. */
  readonly pooledUri: string;
}

export interface NeonClient {
  /**
   * `organizationId` is not optional decoration: Neon answers HTTP 400 to a
   * bare listing when the key's account belongs to an organisation — measured
   * on the first real CI run, not read in the specification.
   */
  listProjects(organizationId?: string): Promise<readonly NeonProjectSummary[]>;
  listOrganizations(): Promise<readonly NeonOrganizationSummary[]>;
  listBranches(projectId: string): Promise<readonly NeonBranch[]>;
  createBranch(projectId: string, name: string): Promise<EphemeralBranch>;
  deleteBranch(projectId: string, branchId: string): Promise<void>;
  waitForBranchReady(
    projectId: string,
    branchId: string,
    options?: { readonly attempts?: number },
  ): Promise<void>;
}

const defaultWait = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/** The API's own explanation of a rejection, if the body carries one. */
function explain(body: string): string {
  try {
    const parsed = apiMessageSchema.safeParse(JSON.parse(body));
    if (parsed.success) return parsed.data.message.slice(0, MAX_API_MESSAGE_LENGTH);
  } catch {
    // A body that is not JSON explains nothing, and that is not an error in
    // itself: the status alone still names the failure.
  }
  return '';
}

/**
 * Parses through a schema, then reports the *paths* that did not match.
 *
 * Never the values: half of what this module handles is a connection string,
 * and a workflow log is public on a public repository (CLAUDE.md §7).
 */
function decode<T>(path: string, schema: z.ZodType<T>, payload: unknown): T {
  const parsed = schema.safeParse(payload);

  if (!parsed.success) {
    throw new NeonResponseError(
      path,
      parsed.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`),
    );
  }

  return parsed.data;
}

export function createNeonClient(options: NeonClientOptions, deps: NeonApiDeps): NeonClient {
  const baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
  const wait = deps.wait ?? defaultWait;

  /**
   * One call, retried where retrying can help.
   *
   * `absentIsSuccess` exists for deletion alone: the cleanup step runs
   * `if: always()`, so it may well run after a failure that already removed
   * the branch. CLAUDE.md §8 requires every operation here to be idempotent,
   * and a 404 on a `DELETE` is the shape idempotence takes.
   */
  async function request(
    method: string,
    path: string,
    body?: unknown,
    absentIsSuccess = false,
  ): Promise<unknown> {
    let lastError = '';

    for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
      if (attempt > 0) await wait(BACKOFF_MS[attempt - 1] ?? 4_000);

      let response: Response;

      try {
        response = await deps.fetch(`${baseUrl}${path}`, {
          method,
          headers: {
            // The key travels in a header, never in the URL: a query string
            // ends up in logs and referrers (CLAUDE.md §8).
            authorization: `Bearer ${options.apiKey}`,
            accept: 'application/json',
            ...(body === undefined ? {} : { 'content-type': 'application/json' }),
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
      } catch (error) {
        lastError = error instanceof Error ? error.name : 'transport error';
        continue;
      }

      if (absentIsSuccess && response.status === 404) return undefined;

      if (response.status >= 400 && response.status < 500) {
        throw new NeonApiError(method, path, response.status, explain(await response.text()));
      }

      if (!response.ok) {
        lastError = `HTTP ${String(response.status)}`;
        continue;
      }

      const text = await response.text();

      try {
        return JSON.parse(text) as unknown;
      } catch {
        // What a gateway returns mid-incident is an HTML page with a 200 on
        // it. Counting it as a failed attempt beats calling it a shape change.
        lastError = 'unparseable body';
      }
    }

    throw new NeonUnavailableError(method, path, ATTEMPTS, lastError);
  }

  return {
    async listProjects(organizationId) {
      const path =
        organizationId === undefined
          ? '/projects'
          : `/projects?org_id=${encodeURIComponent(organizationId)}`;

      return decode(path, projectsSchema, await request('GET', path)).projects;
    },

    async listOrganizations() {
      const path = '/users/me/organizations';
      return decode(path, organizationsSchema, await request('GET', path)).organizations;
    },

    async listBranches(projectId) {
      const path = `/projects/${projectId}/branches`;
      return decode(path, branchesSchema, await request('GET', path)).branches;
    },

    async createBranch(projectId, name) {
      const path = `/projects/${projectId}/branches`;

      // Without an endpoint the branch exists and has no address: Neon creates
      // the compute only when the request asks for one.
      const payload = await request('POST', path, {
        branch: { name },
        endpoints: [{ type: 'read_write' }],
      });

      const created = decode(path, createdBranchSchema, payload);
      const connection = created.connection_uris?.[0];

      if (connection === undefined) {
        throw new Error(
          `Neon created the branch ${created.branch.id} without a connection URI. ` +
            'The API omits one when the parent branch holds more than one role or database; ' +
            'the branch has to be given its endpoint explicitly in that case.',
        );
      }

      return {
        id: created.branch.id,
        name: created.branch.name,
        directUri: connection.connection_uri,
        pooledUri: pooledConnectionUri(
          connection.connection_uri,
          connection.connection_parameters.pooler_host,
        ),
      };
    },

    async deleteBranch(projectId, branchId) {
      await request('DELETE', `/projects/${projectId}/branches/${branchId}`, undefined, true);
    },

    async waitForBranchReady(projectId, branchId, waitOptions) {
      const path = `/projects/${projectId}/branches/${branchId}`;
      const attempts = waitOptions?.attempts ?? READY_ATTEMPTS;

      for (let attempt = 0; attempt < attempts; attempt += 1) {
        if (attempt > 0) await wait(READY_INTERVAL_MS);

        const { branch } = decode(
          path,
          z.object({ branch: branchSchema }),
          await request('GET', path),
        );

        if (branch.current_state === 'ready') return;
      }

      // Named, because the alternative is a connection error inside a driver
      // that nobody can attribute to a compute still starting up.
      throw new Error(
        `The Neon branch ${branchId} never became ready after ${String(attempts)} looks.`,
      );
    },
  };
}
