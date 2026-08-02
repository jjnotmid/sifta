import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FlatCompat } from '@eslint/eslintrc';

/**
 * ESLint 9 flat config.
 *
 * `next lint` is deprecated in Next 15 and prompts interactively the first
 * time it runs, which makes it useless as a build gate — a gate that waits for
 * a keypress never exits 0 in CI. This is the documented migration: the
 * `eslint-config-next` shareable configs loaded through the eslintrc compat
 * layer, driven by the ESLint CLI.
 */
const compat = new FlatCompat({ baseDirectory: dirname(fileURLToPath(import.meta.url)) });

const config = [
  {
    ignores: ['.next/**', 'node_modules/**', 'next-env.d.ts'],
  },
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  {
    rules: {
      // Inline styles are deliberate here. The design brief is a token system,
      // not a utility framework, and every value in this app resolves to a
      // CSS custom property declared in globals.css.
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
];

export default config;
