import js from '@eslint/js';
import globals from 'globals';

/**
 * ESLint בסיסי לאפליקציית דפדפן + Dexie.
 * js/db.js ו-js/sync/ — לדיווח בלבד, בלי --fix.
 */
export default [
  {
    ignores: [
      'node_modules/**',
      'ios/**',
      'dist/**',
      'dist-vercel/**',
      'plugins/**/dist/**',
      'js/vendor/**',
      '**/*.min.js',
    ],
  },
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        Dexie: 'readonly',
        Capacitor: 'readonly',
        Chart: 'readonly',
        XLSX: 'readonly',
        ZXing: 'readonly',
        QRCode: 'readonly',
        fflate: 'readonly',
      },
    },
    rules: {
      ...js.configs.recommended.rules,
      'no-useless-assignment': 'off',
      eqeqeq: ['error', 'smart'],
      'no-unused-vars': 'warn',
      'no-empty': 'warn',
      'no-useless-catch': 'warn',
      'no-useless-escape': 'warn',
      'no-extra-boolean-cast': 'warn',
    },
  },
  {
    files: ['sw.js'],
    languageOptions: {
      sourceType: 'script',
      globals: {
        ...globals.serviceworker,
      },
    },
  },
];
