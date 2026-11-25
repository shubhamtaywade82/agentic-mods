import js from '@eslint/js'

// typescript-eslint 8.74 refuses TypeScript 7.0 (its parser needs the TypeScript 6 API), so
// TypeScript sources are checked by `tsc --strict` with noUnused* enabled instead. This config
// lints the JavaScript tooling until typescript-eslint supports TypeScript 7.
export default [
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      'mods/*/hooks/register.js',
      'mods/**/*.ts',
      'mods/**/*.tsx',
      'packages/**/*.ts',
      'packages/tooling/engine-types/**',
      'plugins/**',
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
]
