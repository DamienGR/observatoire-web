import type { APIResponse, Page, Response } from '@playwright/test';
import { expectedStatus } from '~/lib/http/routes.js';
import { describeErrorChain } from '~/lib/log/errors.js';
import {
  NAVIGATION_PLAN,
  classifyProbe,
  delayBeforeAttempt,
  unavailableMessage,
  wrongAnswerMessage,
  type Probe,
} from '~/lib/preview/readiness.js';

/**
 * Navigating to a deployment that may still be waking, without letting the wait
 * be mistaken for the measurement (issue #46).
 *
 * `src/jobs/warm-preview.ts` already woke every route before this suite
 * started, which is the real fix. This is the second half: a function can be
 * recycled between two tests, and Netlify can have a bad minute in the middle
 * of a run — both happened on 18/8, where `/accessibilite` answered 500 twice
 * in a row while production, running the code of `main`, was timing out at 45 s
 * on the same path (docs/journal.md 028).
 *
 * `retries: 1` in playwright.config.ts is no answer to that: it replays
 * immediately, when waking a function takes seconds and a bad minute of the
 * platform takes minutes — and issue #46 rules out raising it, because a larger
 * retry count hides a real outage exactly as well as it hides a cold start.
 * What is added here is a **bounded** wait that names what it waited for.
 *
 * The rule itself is next door in `src/lib/preview/readiness.ts` and unit
 * tested; no cloud session can reach a public URL (docs/journal.md 020), so the
 * transport below is the part nobody here can exercise, and it is kept as thin
 * as that fact deserves.
 */

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/** A navigation, or the reason there was none, in the classifier's terms. */
async function navigate(page: Page, route: string): Promise<Probe & { response?: Response }> {
  try {
    const response = await page.goto(route);

    // `goto` answers null for a navigation that never left the document. It
    // cannot happen on a plain link-free page load, and reporting it as a
    // status of zero is what keeps it from being read as a 200.
    if (response === null) return { status: 0, error: 'no navigation response' };

    return { status: response.status(), response };
  } catch (error) {
    return { status: 0, error: describeErrorChain(error) };
  }
}

async function fetchOnce(page: Page, route: string): Promise<Probe & { response?: APIResponse }> {
  try {
    const response = await page.request.get(route);
    return { status: response.status(), response };
  } catch (error) {
    return { status: 0, error: describeErrorChain(error) };
  }
}

/**
 * Ask, and ask again while the answer says "not now" — never while it says
 * something else.
 *
 * The generic half of both helpers below, so the two of them cannot drift into
 * two different ideas of what deserves another attempt.
 */
async function untilReady<T>(
  route: string,
  expected: number,
  attempt: (index: number) => Promise<Probe & { response?: T }>,
): Promise<T> {
  const startedAt = Date.now();
  let lastReason = 'no response';

  for (let index = 1; index <= NAVIGATION_PLAN.attempts; index += 1) {
    const delay = delayBeforeAttempt(NAVIGATION_PLAN, index);
    if (delay > 0) await sleep(delay);

    const probe = await attempt(index);
    const verdict = classifyProbe(probe, expected);

    if (verdict.kind === 'ready' && probe.response !== undefined) return probe.response;

    // A definite wrong answer is the site's own failure. It is raised at once,
    // with both statuses in the message: §5 wants a real defect reported
    // quickly, and waiting on it would only blame the platform for it.
    if (verdict.kind === 'wrong') {
      throw new Error(wrongAnswerMessage(route, probe, expected));
    }

    lastReason = verdict.reason;
  }

  throw new Error(
    unavailableMessage({
      target: route,
      attempts: NAVIGATION_PLAN.attempts,
      elapsedMs: Date.now() - startedAt,
      lastReason,
    }),
  );
}

/**
 * Goes to a route and returns the response, or fails saying which of the two
 * things went wrong.
 *
 * Every test of this suite navigates through it, and that is what removes the
 * defect issue #46 was opened on: an availability failure used to surface as
 * `expect(response?.status()).toBe(200)` inside a test called "raises no
 * axe-core violation", so a hurried reader concluded there was a contrast
 * regression. Now the words say the preview did not answer, and the status
 * claim has a test of its own (availability.spec.ts).
 */
export async function gotoReady(
  page: Page,
  route: string,
  expected: number = expectedStatus(route),
): Promise<Response> {
  return untilReady(route, expected, () => navigate(page, route));
}

/**
 * The same, for the bytes rather than the rendering.
 *
 * Used where a test reads the served HTML instead of the live DOM. Without it
 * such a test passes vacuously on a 500: an error page carries none of the
 * markup being looked for, so "not found" and "not served" look alike.
 */
export async function requestReady(
  page: Page,
  route: string,
  expected: number = expectedStatus(route),
): Promise<APIResponse> {
  return untilReady(route, expected, () => fetchOnce(page, route));
}
