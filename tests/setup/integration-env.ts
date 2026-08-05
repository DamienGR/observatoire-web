/**
 * The integration project runs against a real, ephemeral Neon branch
 * (CLAUDE.md §5). Failing here with a clear message beats failing later inside
 * a driver with a connection error nobody can attribute.
 */
if (!process.env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL is required by the integration test project.\n' +
      'In CI it points at an ephemeral Neon branch — never at production ' +
      '(CLAUDE.md §7). Run `pnpm test` for the unit project instead.',
  );
}
