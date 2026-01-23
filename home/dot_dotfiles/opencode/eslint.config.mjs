import eslint from '@eslint/js'
import tseslint from 'typescript-eslint'

export default eslint.configs(
  // Global ignores MUST come first to prevent scanning these directories
  {
    ignores: ['node_modules/**', 'dist/**', 'docker/**'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
    },
    rules: {
      // Disable all style/formatting rules - Biome handles these
      // Focus only on code quality, bugs, and logic issues

      // TypeScript-specific quality rules
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-floating-promises': 'off', // Requires type-checked config
      '@typescript-eslint/no-misused-promises': 'off', // Requires type-checked config
      '@typescript-eslint/await-thenable': 'off', // Requires type-checked config
      '@typescript-eslint/no-unnecessary-condition': 'off', // Requires type-checked config
      '@typescript-eslint/prefer-nullish-coalescing': 'off', // Requires type-checked config
      '@typescript-eslint/prefer-optional-chain': 'off', // Requires type-checked config
      '@typescript-eslint/no-non-null-assertion': 'warn',
      '@typescript-eslint/no-require-imports': 'error',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],

      // Core ESLint quality rules (non-style)
      'no-console': 'off', // Allow console in tooling code
      'no-debugger': 'error',
      'no-duplicate-case': 'error',
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-extra-boolean-cast': 'error',
      'no-irregular-whitespace': 'error',
      'no-loss-of-precision': 'error',
      'no-sparse-arrays': 'error',
      'no-template-curly-in-string': 'error',
      'no-unreachable': 'error',
      'no-unsafe-finally': 'error',
      'use-isnan': 'error',
      'valid-typeof': 'error',

      // Best practices
      'array-callback-return': 'error',
      'default-case-last': 'error',
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-caller': 'error',
      'no-constructor-return': 'error',
      'no-empty-pattern': 'error',
      'no-eval': 'error',
      'no-extend-native': 'error',
      'no-implied-eval': 'error',
      'no-iterator': 'error',
      'no-labels': 'error',
      'no-lone-blocks': 'error',
      'no-new-wrappers': 'error',
      'no-octal': 'error',
      'no-octal-escape': 'error',
      'no-proto': 'error',
      'no-return-assign': 'error',
      'no-self-assign': 'error',
      'no-self-compare': 'error',
      'no-sequences': 'error',
      'no-throw-literal': 'error',
      'no-unmodified-loop-condition': 'error',
      'no-unused-expressions': 'error',
      'no-useless-call': 'error',
      'no-useless-catch': 'error',
      'no-useless-concat': 'error',
      'no-useless-escape': 'error',
      'no-useless-return': 'error',
      'no-void': 'error',
      'no-with': 'error',
      'prefer-promise-reject-errors': 'error',
      radix: 'error',
      'require-await': 'off', // Can be noisy, disable if problematic

      // Variables
      'no-delete-var': 'error',
      'no-shadow-restricted-names': 'error',
      'no-undef-init': 'error',
    },
  }
)
