/**
 * The one place in the repository allowed to make a real third-party request,
 * and the shape of that permission.
 *
 * Plain `fetch`, not the guarded client of `src/lib/fetch/`: that guard exists
 * for URLs a directory hands us, which may point anywhere. These addresses are
 * ours, hard-coded, and government APIs.
 *
 * The retry is not politeness, it is the difference between a useful check and
 * a useless one. `geo.api.gouv.fr` answered a 503 on the first run of this
 * suite, on a request that had succeeded minutes earlier. A contract test that
 * reports someone else's bad minute as "the shape drifted" is a test whose
 * verdict nobody reads — and this whole layer exists to be believed when it
 * goes red.
 */
const USER_AGENT = 'observatoire-web contract test (+https://github.com/DamienGR/observatoire-web)';

const ATTEMPTS = 4;
const BACKOFF_MS = [1_000, 4_000, 10_000];

export interface FetchedJson {
  /** The bytes as sent. Some assertions have to see the encoding, not the value. */
  readonly text: string;
  readonly json: unknown;
}

const wait = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

export async function fetchJson(source: string, url: string): Promise<FetchedJson> {
  let lastError = '';

  for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
    if (attempt > 0) await wait(BACKOFF_MS[attempt - 1] ?? 10_000);

    try {
      const response = await fetch(url, { headers: { 'user-agent': USER_AGENT } });
      if (response.ok) {
        const text = await response.text();
        return { text, json: JSON.parse(text) as unknown };
      }
      lastError = `HTTP ${String(response.status)}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : 'transport error';
    }
  }

  throw new Error(
    `${source} did not answer after ${String(ATTEMPTS)} attempts (${lastError}).\n` +
      `URL: ${url}\n` +
      'This is an availability failure, not a contract failure: the shape of ' +
      'the payload was never observed. Re-run before changing any schema.',
  );
}
