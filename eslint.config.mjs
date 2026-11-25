import js from '@eslint/js'
import tseslint from 'typescript-eslint'

// typescript-eslint 8.74 refuses TypeScript 7.0, so the repo pins TypeScript 5.9 until it does.
export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      'mods/*/hooks/register.js',
      'packages/tooling/engine-types/**',
      'plugins/**',
      '.remember/**',
      '.omc/**',
    ],
  },
  js.configs.recommended,
  {
    files: ['**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { console: 'readonly', process: 'readonly', Buffer: 'readonly' },
    },
  },
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx,mts}'],
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
)
