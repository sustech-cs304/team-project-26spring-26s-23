module.exports = {
  root: true,
  env: { browser: true, node: true, es2020: true },
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:react-hooks/recommended',
  ],
  ignorePatterns: ['dist', 'dist-electron', 'build', 'coverage', '.eslintrc.cjs'],
  parser: '@typescript-eslint/parser',
  plugins: ['react-refresh', 'sonarjs'],
  rules: {
    '@typescript-eslint/no-unused-vars': [
      'error',
      {
        argsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
      },
    ],
    complexity: ['warn', 16],
    'max-depth': ['warn', 4],
    'max-lines-per-function': [
      'warn',
      {
        max: 120,
        skipBlankLines: true,
        skipComments: true,
      },
    ],
    'max-params': ['warn', 4],
    'sonarjs/cognitive-complexity': ['warn', 15],
    'sonarjs/no-duplicate-string': ['warn', { threshold: 4 }],
    'sonarjs/no-duplicated-branches': 'warn',
    'sonarjs/no-identical-conditions': 'warn',
    'sonarjs/no-identical-functions': ['warn', 8],
    'react-refresh/only-export-components': [
      'warn',
      { allowConstantExport: true },
    ],
  },
}
