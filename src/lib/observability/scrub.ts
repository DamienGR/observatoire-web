/**
 * Scrubbing applied to every Sentry event, client and server (CLAUDE.md §7:
 * "Ne jamais logger un secret, une chaîne de connexion, ni le contenu d'un
 * en-tête Authorization — y compris dans les breadcrumbs Sentry").
 *
 * Written as a pure function rather than as a closure inside the Sentry config
 * so that it is unit tested: a scrubbing rule nobody exercises is a rule that
 * silently stops matching the day a header is renamed.
 *
 * The policy is an allowlist, not a denylist. A denylist has to guess the name
 * of the next secret-bearing header; an allowlist only has to be widened on
 * purpose, in a diff.
 */

/** Headers kept on a reported event. Everything else is dropped. */
export const ALLOWED_REQUEST_HEADERS = ['content-type', 'user-agent'] as const;

export interface ScrubbableRequest {
  url?: string;
  headers?: Record<string, string>;
  cookies?: Record<string, string>;
  query_string?: unknown;
}

export interface ScrubbableBreadcrumb {
  data?: Record<string, unknown>;
}

export interface ScrubbableEvent {
  request?: ScrubbableRequest;
  breadcrumbs?: ScrubbableBreadcrumb[];
}

/**
 * A URL without its query string or its fragment.
 *
 * Both carry secrets in practice: an API key appended to a PSI call, an ops
 * token someone put in a query string despite §8. Parsing is avoided on
 * purpose — Sentry reports relative URLs in breadcrumbs, and `new URL` would
 * throw on them.
 */
export function stripQueryString(url: string): string {
  const cut = url.search(/[?#]/);
  return cut === -1 ? url : url.slice(0, cut);
}

/** Applies the policy to an event, in place, and returns it. */
export function scrubEvent<E extends ScrubbableEvent>(event: E): E {
  const request = event.request;

  if (request !== undefined) {
    if (request.headers !== undefined) {
      request.headers = Object.fromEntries(
        Object.entries(request.headers).filter(([name]) =>
          (ALLOWED_REQUEST_HEADERS as readonly string[]).includes(name.toLowerCase()),
        ),
      );
    }

    delete request.cookies;
    delete request.query_string;

    if (request.url !== undefined) {
      request.url = stripQueryString(request.url);
    }
  }

  for (const breadcrumb of event.breadcrumbs ?? []) {
    const data = breadcrumb.data;
    if (data !== undefined && typeof data.url === 'string') {
      data.url = stripQueryString(data.url);
    }
  }

  return event;
}
