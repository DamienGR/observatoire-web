import { defineConfig } from 'drizzle-kit';

/**
 * Migrations run against the *direct* connection: the pooled endpoint does not
 * support the session-level statements a migration needs (CLAUDE.md §9).
 * The schema itself lands in J1-08.
 */
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  dbCredentials: {
    url: process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL ?? '',
  },
  strict: true,
  verbose: true,
});
