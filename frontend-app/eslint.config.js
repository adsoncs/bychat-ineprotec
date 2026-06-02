import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'

export default tseslint.config(
  {
    ignores: ['dist', 'dist-ladle', 'node_modules', 'playwright-report', 'test-results', '.ladle/build'],
  },

  // JS base recomendado para todos os arquivos
  {
    files: ['**/*.{js,mjs,cjs,ts,tsx}'],
    ...js.configs.recommended,
  },

  // Typed linting apenas para arquivos do projeto que têm projeto TS
  ...tseslint.configs.recommendedTypeChecked.map((c) => ({
    ...c,
    files: ['src/**/*.{ts,tsx}', 'tests/**/*.ts', 'vite.config.ts', 'playwright.config.ts', '.ladle/*.tsx'],
  })),
  ...tseslint.configs.stylisticTypeChecked.map((c) => ({
    ...c,
    files: ['src/**/*.{ts,tsx}', 'tests/**/*.ts', 'vite.config.ts', 'playwright.config.ts', '.ladle/*.tsx'],
  })),

  // Configuração typed para src/
  {
    files: ['src/**/*.{ts,tsx}', 'tests/**/*.ts', 'vite.config.ts', 'playwright.config.ts', '.ladle/*.tsx'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      parserOptions: {
        project: ['./tsconfig.app.json', './tsconfig.node.json', './tsconfig.stories.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      globals: {
        window: 'readonly',
        document: 'readonly',
        localStorage: 'readonly',
        fetch: 'readonly',
        console: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        HTMLElement: 'readonly',
        HTMLInputElement: 'readonly',
        HTMLButtonElement: 'readonly',
        HTMLDivElement: 'readonly',
        Event: 'readonly',
        KeyboardEvent: 'readonly',
        MouseEvent: 'readonly',
        getComputedStyle: 'readonly',
      },
    },
    plugins: {
      'react-hooks': reactHooks,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      '@typescript-eslint/no-import-type-side-effects': 'error',
      '@typescript-eslint/no-misused-promises': ['error', { checksVoidReturn: { attributes: false } }],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },

  // Stories: relaxar regras
  {
    files: ['src/**/*.stories.tsx'],
    rules: {
      'no-console': 'off',
    },
  },

  // Configs e arquivos JS sem typed linting
  {
    files: ['*.{js,mjs,cjs}', '.ladle/*.{js,mjs,cjs}', 'eslint.config.js', 'stylelint.config.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
    },
    rules: {
      'no-console': 'off',
    },
  },
)
