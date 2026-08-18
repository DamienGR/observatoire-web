/**
 * Promotes the TLS modes `pg` is about to weaken.
 *
 * `pg` warns on every connection this repository opens:
 *
 *   The SSL modes 'prefer', 'require', and 'verify-ca' are treated as aliases
 *   for 'verify-full'. In the next major version (pg-connection-string v3.0.0
 *   and pg v9.0.0), these modes will adopt standard libpq semantics, which
 *   have weaker security guarantees.
 *
 * Neon writes `sslmode=require` into every connection string it generates, so
 * every connection here is affected: production, the ephemeral CI branches, and
 * the site's own reads. Today `pg` treats that as `verify-full`; under `pg` 9
 * it will encrypt without verifying the certificate, which is what libpq's
 * `require` means.
 *
 * **Nothing will break on that day.** The connection will work and check less —
 * a silent downgrade arriving through a version bump nobody would read as a
 * security change. §7 has no rule for "weaker later", so this makes the
 * intention explicit now, while the two readings still agree and a mistake is
 * therefore visible immediately rather than in six months.
 */

/** The three modes whose meaning changes. Exported so the test can enumerate them. */
export const AMBIGUOUS_SSL_MODES = ['prefer', 'require', 'verify-ca'] as const;

/**
 * Rewrites an ambiguous `sslmode` to `verify-full`, and touches nothing else.
 *
 * Deliberately narrow. It does **not** add `sslmode` where none is asked for:
 * the throwaway Postgres a session runs speaks no TLS, and demanding a verified
 * certificate there would break every integration run for a reason foreign to
 * production. It does not override an explicit `disable` either — that one was
 * written on purpose, and silently encrypting is a different bug from silently
 * not verifying.
 *
 * A string it cannot parse comes back untouched: this is not the module that
 * validates a connection string, and failing here would replace a connection
 * error that names the problem with a crash at import that does not.
 */
export function withVerifiedTls(connectionString: string): string {
  let url: URL;

  try {
    url = new URL(connectionString);
  } catch {
    return connectionString;
  }

  const mode = url.searchParams.get('sslmode');

  if (
    mode === null ||
    !AMBIGUOUS_SSL_MODES.includes(mode as (typeof AMBIGUOUS_SSL_MODES)[number])
  ) {
    return connectionString;
  }

  url.searchParams.set('sslmode', 'verify-full');
  return url.href;
}
