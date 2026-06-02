/**
 * Stylelint — barreira que impede a dívida do CSS legado voltar.
 *
 * Regras críticas:
 *   - Proíbe !important (ADR-001 sobre não repetir patches do legado)
 *   - Proíbe valores px hardcoded em arquivos do shell (devem usar tokens)
 *   - Tailwind v4: tolerar @theme, @apply, @layer, @utility, etc.
 */

export default {
  extends: ['stylelint-config-standard'],
  rules: {
    'declaration-no-important': true,

    // Tailwind v4 / CSS Color Level 4 — formato moderno (oklch space-separated)
    'lightness-notation': null,
    'hue-degree-notation': null,
    'alpha-value-notation': null,
    'color-function-notation': null,
    'comment-empty-line-before': null,
    'media-feature-range-notation': null,
    'import-notation': null,
    'value-keyword-case': null,

    'at-rule-no-unknown': [
      true,
      {
        ignoreAtRules: [
          'theme',
          'utility',
          'variant',
          'custom-variant',
          'apply',
          'layer',
          'screen',
          'tailwind',
          'plugin',
          'source',
          'config',
        ],
      },
    ],

    'no-descending-specificity': null,
    'declaration-empty-line-before': null,
    'custom-property-empty-line-before': null,

    'selector-class-pattern': [
      '^[a-z][a-zA-Z0-9-]+$',
      {
        message: 'Classes em kebab-case ou camelCase (sem snake_case ou começando com número)',
        resolveNestedSelectors: true,
      },
    ],
  },

  overrides: [
    {
      files: ['src/styles/app-shell.css', 'src/styles/sidebar.css', 'src/styles/topbar.css'],
      rules: {
        'unit-disallowed-list': [
          ['px'],
          {
            ignoreProperties: { px: ['border', 'border-width', 'outline', 'outline-width', 'box-shadow'] },
            message: 'Use tokens (var(--*)) ou rem/em em arquivos do shell — px é proibido aqui',
          },
        ],
      },
    },
  ],
}
