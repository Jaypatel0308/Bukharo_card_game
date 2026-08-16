// @ts-check
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import jsxA11y from 'eslint-plugin-jsx-a11y';

/**
 * Lint configuration.
 *
 * Chosen to catch bugs rather than to argue about style: there is no formatter
 * in this project and no stylistic rules here. The rules that earn their place
 * are the ones a human reviewer reliably misses — hook dependencies, unused
 * bindings, accidental globals, and accessibility attributes.
 *
 * Type-aware linting is deliberately not enabled. It is slower and needs a
 * program per package; the rules below already cover the failure modes this
 * codebase has actually produced.
 */
export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/node_modules/**', '**/*.tsbuildinfo', 'data/**'],
  },

  {
    // A suppression that no longer suppresses anything is a lie about the
    // code, so stale ones are reported rather than left to accumulate.
    linterOptions: { reportUnusedDisableDirectives: 'error' },
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    rules: {
      // An unused binding is usually a leftover from an edit that went half
      // way. Leading underscores mark the deliberate ones.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-var': 'error',
      'prefer-const': 'error',
      'no-implicit-coercion': 'off',
      // The non-null assertions in this codebase are load bearing: array
      // indexing under noUncheckedIndexedAccess produces them constantly.
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },

  // ---- Node: engine, shared protocol, server ----
  {
    files: ['packages/**/*.ts', 'apps/server/**/*.ts'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },

  // ---- Browser: the React client ----
  {
    files: ['apps/web/src/**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.browser },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: {
      'react-hooks': reactHooks,
      'jsx-a11y': jsxA11y,
    },
    rules: {
      // The rule that matters most here: a wrong dependency array is a stale
      // closure, and stale closures in this client mean cards that do not move.
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      ...jsxA11y.flatConfigs.recommended.rules,
    },
  },

  // ---- Tests ----
  {
    files: ['**/*.test.{ts,tsx,mjs}', 'packages/game-engine/test/**', 'apps/server/test/**'],
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      // Test scaffolding legitimately reaches into shapes the app never sees.
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
);
