/**
 * Display formatting for the figures of `/stats`.
 *
 * Separate from `view.ts` because the two answer different questions: what the
 * page says (a view model of numbers) and how a French reader reads it. Keeping
 * the numbers unformatted until the last moment is also what lets the view be
 * asserted on values rather than on strings.
 *
 * CLAUDE.md §4: dates are stored and manipulated in UTC, and formatted in
 * `Europe/Paris` only for display. That conversion happens here and nowhere
 * else, which is why the time zone is a constant of this module rather than an
 * option a caller can forget to pass.
 */

const LOCALE = 'fr-FR';
const TIME_ZONE = 'Europe/Paris';

/**
 * Formatters are built once. `Intl.NumberFormat` is expensive to construct and
 * a server rendering a table builds one per cell otherwise.
 */
const COUNT = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 0 });

const SHARE = new Intl.NumberFormat(LOCALE, {
  style: 'percent',
  maximumFractionDigits: 1,
});

const DATE_TIME = new Intl.DateTimeFormat(LOCALE, {
  dateStyle: 'long',
  timeStyle: 'short',
  timeZone: TIME_ZONE,
});

/** A count, with thousands grouped: `1 067`. */
export function formatCount(value: number): string {
  return COUNT.format(value);
}

/**
 * A proportion between 0 and 1, as a percentage: `12,3 %`.
 *
 * One decimal at most, and none when the number is whole: `100 %`, not
 * `100,0 %`. A page whose subject is measurement precision should not display
 * precision it does not have.
 */
export function formatShare(value: number): string {
  return SHARE.format(value);
}

/** An instant, read in Paris: `10 août 2026 à 00:30`. */
export function formatDateTime(value: Date): string {
  return DATE_TIME.format(value);
}

/** The machine-readable form of the same instant, for `<time datetime>`. */
export function toDateTimeAttribute(value: Date): string {
  return value.toISOString();
}
