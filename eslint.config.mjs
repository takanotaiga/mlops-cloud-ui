// ESLint flat config for ESLint v9+
// Composes flat configs from core, React, TS, a11y, import, and Next.
import js from '@eslint/js';
import globals from 'globals';
import tsParser from '@typescript-eslint/parser';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import importPlugin from 'eslint-plugin-import';
import nextPlugin from '@next/eslint-plugin-next';
import tsEslint from '@typescript-eslint/eslint-plugin';

export default [
  // Ignore build artifacts and vendor dirs
  {
    ignores: [
      'node_modules/**',
      '.next/**',
      'dist/**',
      'coverage/**',
      'public/**',
      'eslint.config.*',
    ],
  },

  // Global settings
  {
    settings: {
      react: { version: 'detect' },
    },
  },

  // Base JS recommended
  js.configs.recommended,

  // React recommended (flat)
  react.configs.flat.recommended,

  // (Hooks rules are added explicitly below)

  // A11y recommended (flat)
  jsxA11y.flatConfigs.recommended,

  // Import plugin recommended + TS resolver
  importPlugin.flatConfigs.recommended,
  importPlugin.flatConfigs.typescript,

  // TypeScript recommended (flat)
  ...tsEslint.configs['flat/recommended'],

  // Next.js Core Web Vitals rules (flat)
  nextPlugin.flatConfig.coreWebVitals,

  // Project-specific language options and rule tweaks
  {
    files: ['**/*.{js,jsx,ts,tsx}'],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    plugins: {
      'react-hooks': reactHooks,
    },
    settings: {
      react: { version: 'detect' },
      // Support TypeScript path resolution for import plugin
      'import/resolver': {
        node: { extensions: ['.js', '.jsx', '.ts', '.tsx'] },
        typescript: { alwaysTryTypes: true },
      },
    },
    rules: {
      // Project style
      semi: ['error', 'always'],
      quotes: ['error', 'double'],

      // Common React tweaks for Next/React 17+
      'react/react-in-jsx-scope': 'off',
      'react/jsx-uses-react': 'off',

      // Hooks enforcement
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  // TypeScript-specific adjustments
  {
    files: ['**/*.ts', '**/*.tsx'],
    rules: {
      // TypeScript provides type checking; this rule is redundant and noisy
      'no-undef': 'off',
      // Relax overly strict rules for this codebase
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    },
  },
];
