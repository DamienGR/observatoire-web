import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import astro from 'eslint-plugin-astro';
import globals from 'globals';

/**
 * Flat config. `pnpm lint` runs with --max-warnings=0: a warning nobody has to
 * fix is a warning everybody learns to ignore, and CI is the only judge here
 * (CLAUDE.md §1).
 */
export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'dist-jobs/**',
      '.astro/**',
      '.netlify/**',
      'coverage/**',
      'node_modules/**',
      'playwright-report/**',
      'test-results/**',
      '.stryker-tmp/**',
      'reports/**',
      'src/env.d.ts',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  ...astro.configs.recommended,
  ...astro.configs['jsx-a11y-strict'],

  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
      globals: { ...globals.node },
    },
    rules: {
      // CLAUDE.md §4: no implicit or explicit `any` without a commented
      // justification. The escape hatch stays available, but it has to be
      // written down.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/explicit-module-boundary-types': 'error',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],

      // §4: env vars are read through src/lib/env, never off process.env
      // directly, so the PUBLIC_ discipline has a single place to live.
      'no-restricted-properties': [
        'error',
        {
          object: 'process',
          property: 'env',
          message: 'Read environment variables through src/lib/env (CLAUDE.md §9).',
        },
      ],

      // §4: no console.log outside development scripts — use the app logger.
      'no-console': ['error', { allow: ['warn', 'error'] }],
    },
  },

  // src/lib/ is pure logic: it must never reach into a route (CLAUDE.md §4).
  {
    files: ['src/lib/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/pages/**', '~/pages/*'],
              message: 'src/lib/ must not import from src/pages/ (CLAUDE.md §4).',
            },
          ],
        },
      ],
    },
  },

  // The env module is the one place allowed to describe process.env.
  {
    files: [
      'src/lib/env/**/*.ts',
      'tests/setup/**/*.ts',
      'scripts/**/*.mjs',
      '*.config.ts',
      '*.config.mjs',
      '*.config.js',
    ],
    rules: { 'no-restricted-properties': 'off' },
  },

  // Standalone scripts are plain ESM, outside the TypeScript program: type-aware
  // rules cannot run on them. They are also allowed to write to stdout — that is
  // their entire job.
  {
    files: ['scripts/**/*.mjs', 'eslint.config.js'],
    ...tseslint.configs.disableTypeChecked,
    rules: {
      ...tseslint.configs.disableTypeChecked.rules,
      'no-console': 'off',
    },
  },

  {
    files: ['**/*.test.ts', 'tests/**/*.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
    },
  },

  // Type-aware rules are switched off on `.astro` files, and the reason is
  // measured rather than assumed. `astro-eslint-parser` does not support
  // `projectService` and falls back to `project: true`; template expressions
  // then resolve to the `error` type, which the `no-unsafe-*` family reports as
  // a violation. Every `{items.map(...)}` in a page is flagged, and no amount
  // of rewriting satisfies a rule reading a type that could not be computed.
  //
  // Little is lost: `astro check` runs the Astro language server over the same
  // files with real types, it is part of `pnpm verify`, and it is what actually
  // typechecks a component. What stays on here is everything that does not need
  // types — including the whole jsx-a11y set, which is why these files are
  // linted at all.
  {
    files: ['**/*.astro'],
    ...tseslint.configs.disableTypeChecked,
    rules: {
      ...tseslint.configs.disableTypeChecked.rules,

      // Astro components are typed through their frontmatter; requiring an
      // explicit return type on every template expression adds noise, not safety.
      '@typescript-eslint/explicit-module-boundary-types': 'off',

      // A scrollable region must be reachable by keyboard, or its content is
      // unreachable without a mouse — axe-core reports it as
      // `scrollable-region-focusable`. The technique for that is exactly a
      // `tabindex="0"` on an element carrying `role="region"` and a label, which
      // this rule flags by default because the element is not interactive.
      'astro/jsx-a11y/no-noninteractive-tabindex': [
        'error',
        { tags: [], roles: ['tabpanel', 'region'], allowExpressionValues: true },
      ],
    },
  },
);
