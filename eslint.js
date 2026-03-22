const tseslint = require('typescript-eslint');
const reactPlugin = require('eslint-plugin-react');
const reactHooksPlugin = require('eslint-plugin-react-hooks');
const jsxA11yPlugin = require('eslint-plugin-jsx-a11y');

const defaultIgnores = [
    '**/node_modules/**',
    '**/bin/**',
    '**/bin-dev/**',
    '**/.generated/**',
    '**/var/**',
];

const createDoubleAssertionSelector = (typeKeyword) =>
    `TSAsExpression[expression.type='TSAsExpression'][expression.typeAnnotation.type='${typeKeyword}']`;

const createProteumEslintConfig = ({ ignores = [] } = {}) => [
    {
        ignores: [...defaultIgnores, ...ignores],
    },
    {
        linterOptions: {
            reportUnusedDisableDirectives: 'off',
        },
    },
    {
        files: ['**/*.{ts,tsx,mts,cts}'],
        languageOptions: {
            parser: tseslint.parser,
            parserOptions: {
                ecmaVersion: 'latest',
                sourceType: 'module',
                ecmaFeatures: {
                    jsx: true,
                },
            },
        },
        plugins: {
            '@typescript-eslint': tseslint.plugin,
            react: reactPlugin,
            'react-hooks': reactHooksPlugin,
            'jsx-a11y': jsxA11yPlugin,
        },
        rules: {
            'no-restricted-syntax': [
                'error',
                {
                    selector: createDoubleAssertionSelector('TSUnknownKeyword'),
                    message: 'Do not use double assertions through `unknown`.',
                },
                {
                    selector: createDoubleAssertionSelector('TSAnyKeyword'),
                    message: 'Do not use double assertions through `any`.',
                },
            ],
        },
    },
];

module.exports = {
    createProteumEslintConfig,
};
