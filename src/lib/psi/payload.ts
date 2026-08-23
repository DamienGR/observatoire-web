import { z } from 'zod';

/**
 * What PageSpeed Insights answers, parsed rather than cast (CLAUDE.md §4).
 *
 * Written **after** the observation, and that order is doctrine rather than
 * laziness: §5 says a third-party API is observed first and the observation is
 * then frozen, because the specification here is "what PSI actually does", not
 * what its reference page says. The payloads this schema was written against
 * are in `tests/fixtures/psi/`, captured on 23 August 2026 by a manual dispatch
 * of the Contracts workflow — the only way any of this can be seen from a
 * session at all (docs/journal.md 027 and 032).
 *
 * The schema is **permissive about what it accepts and strict about what it
 * produces**, like `src/lib/sources/`. Zod strips what is not named here, and a
 * 700 kB report has a great deal that is not named here: the full-page
 * screenshot alone is three quarters of the bytes, and CLAUDE.md §11.1 says
 * what this project does with a raw Lighthouse report.
 *
 * One field is *not* constrained on purpose. `scoreDisplayMode` is read as a
 * plain string and compared later, because Lighthouse adds modes between minor
 * versions — `metricSavings` arrived in v11 — and a union here would reject a
 * whole report over an audit nobody reads.
 */

/** A value the API sends that this schema cannot make sense of. */
export class PsiPayloadError extends Error {
  override readonly name = 'PsiPayloadError';
  readonly issues: readonly string[];

  constructor(summary: string, issues: readonly string[] = []) {
    super(
      `${summary}${issues.length === 0 ? '' : `:\n${issues.map((issue) => `  - ${issue}`).join('\n')}`}\n` +
        'The frozen payloads are in tests/fixtures/psi/ and tests/contract/psi.test.ts ' +
        'asks the real API the same questions weekly.',
    );
    this.issues = issues;
  }
}

/**
 * Every audit of the report, in the three shapes anything downstream reads: a
 * score, a number, and a list whose *length* is an occurrence count.
 *
 * `items` is an array of `unknown` deliberately. An axe item carries a DOM
 * snippet, a bounding rectangle and an explanation — a node of somebody's site,
 * which §7 treats as hostile data and which nothing here has any business
 * looking inside. What we need from it is how many there are.
 */
const auditSchema = z.object({
  id: z.string().min(1),
  /** `null` whenever `scoreDisplayMode` says the audit was not scored. */
  score: z.number().min(0).max(1).nullable(),
  scoreDisplayMode: z.string().min(1),
  numericValue: z.number().optional(),
  numericUnit: z.string().optional(),
  displayValue: z.string().optional(),
  details: z
    .object({
      type: z.string().optional(),
      items: z.array(z.unknown()).optional(),
      /** Where Lighthouse puts the axe-core impact level (`core/audits/accessibility/axe-audit.js`). */
      debugData: z
        .object({
          impact: z.string().optional(),
        })
        .optional(),
    })
    .optional(),
});

export type PsiAudit = z.infer<typeof auditSchema>;

const categorySchema = z.object({
  id: z.string().min(1),
  /** 0–1, two decimals. `null` when the category could not be computed. */
  score: z.number().min(0).max(1).nullable(),
  auditRefs: z.array(
    z.object({
      id: z.string().min(1),
      /** Zero for audits that do not move the score. They still fail. */
      weight: z.number(),
      group: z.string().optional(),
    }),
  ),
});

const lighthouseResultSchema = z.object({
  requestedUrl: z.string().optional(),
  /**
   * The URL of the last document request — where the redirects landed. Optional
   * because Lighthouse marks it so for the gather modes PSI does not use.
   */
  mainDocumentUrl: z.string().optional(),
  finalDisplayedUrl: z.string().min(1),
  lighthouseVersion: z.string().min(1),
  /** Strict: this becomes `measurement.fetched_at`, and a `timestamptz` (§4). */
  fetchTime: z.iso.datetime(),
  runWarnings: z.array(z.string()).optional(),
  /**
   * Present when the run produced a report Lighthouse itself does not trust.
   * Never observed in the capture; kept because the API documents it and a
   * report that fails silently is the one worth naming.
   */
  runtimeError: z
    .object({
      code: z.string().min(1),
      message: z.string().optional(),
    })
    .optional(),
  environment: z
    .object({
      /** `{"axe-core": "4.12.1"}` on 23 August 2026 — the findings' provenance. */
      credits: z.record(z.string(), z.string().optional()).optional(),
    })
    .optional(),
  configSettings: z
    .object({
      formFactor: z.string().optional(),
      locale: z.string().optional(),
      onlyCategories: z.array(z.string()).optional(),
    })
    .optional(),
  categories: z.record(z.string(), categorySchema),
  audits: z.record(z.string(), auditSchema),
});

export type PsiReport = z.infer<typeof lighthouseResultSchema>;

const successSchema = z.object({
  /** `CAPTCHA_NOT_NEEDED` in every capture. Kept: a captcha would explain a lot. */
  captchaResult: z.string().optional(),
  kind: z.string().optional(),
  id: z.string().optional(),
  analysisUTCTimestamp: z.string().optional(),
  lighthouseResult: lighthouseResultSchema,
});

/**
 * The error envelope, observed twice on 23 August 2026 and identical both
 * times but for one word of prose:
 *
 *     {"error":{"code":400,"message":"Lighthouse returned error:
 *      FAILED_DOCUMENT_REQUEST. …(Details: net::ERR_FAILED)",
 *      "errors":[{"message":"…","domain":"lighthouse",
 *      "reason":"lighthouseUserError"}]}}
 *
 * `domain` and `reason` are what separate "the page would not load" from "the
 * request was wrong", and that separation is the whole of `outcome.ts`.
 */
const apiErrorSchema = z.object({
  error: z.object({
    code: z.number().int(),
    message: z.string().optional(),
    status: z.string().optional(),
    errors: z
      .array(
        z.object({
          message: z.string().optional(),
          domain: z.string().optional(),
          reason: z.string().optional(),
        }),
      )
      .optional(),
  }),
});

export type PsiApiError = z.infer<typeof apiErrorSchema>['error'];

export type PsiResponse =
  | { readonly kind: 'report'; readonly report: PsiReport }
  | { readonly kind: 'error'; readonly error: PsiApiError };

function describe(error: z.ZodError): readonly string[] {
  return error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`);
}

/**
 * One decoded body, told apart by which envelope it carries.
 *
 * The `error` key is tested first because that is the cheaper and surer signal:
 * a failed run has no `lighthouseResult` at all, so trying the report schema
 * first would produce a list of missing-field complaints about a payload that
 * is perfectly well formed and simply says no.
 */
export function parsePsiResponse(body: unknown): PsiResponse {
  if (typeof body !== 'object' || body === null) {
    throw new PsiPayloadError('The PageSpeed Insights response is not a JSON object');
  }

  if ('error' in body) {
    const parsed = apiErrorSchema.safeParse(body);
    if (!parsed.success) {
      throw new PsiPayloadError(
        'The PageSpeed Insights error envelope has an unexpected shape',
        describe(parsed.error),
      );
    }
    return { kind: 'error', error: parsed.data.error };
  }

  const parsed = successSchema.safeParse(body);
  if (!parsed.success) {
    throw new PsiPayloadError(
      'The PageSpeed Insights report has an unexpected shape',
      describe(parsed.error),
    );
  }

  return { kind: 'report', report: parsed.data.lighthouseResult };
}
