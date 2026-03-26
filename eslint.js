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

const createZodTypeFactorySelector = (factoryName) =>
    `CallExpression[callee.type='MemberExpression'][callee.computed=false][callee.object.type='Identifier'][callee.object.name=/^(schema|z|zod)$/][callee.property.name='${factoryName}']`;

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
            '@typescript-eslint/no-explicit-any': 'error',
            'no-restricted-syntax': [
                'error',
                {
                    selector: 'TSUnknownKeyword',
                    message: 'Do not use `unknown`; define an explicit type instead.',
                },
                {
                    selector: createZodTypeFactorySelector('any'),
                    message: 'Do not use Zod `any()` schemas; define an explicit schema instead.',
                },
                {
                    selector: createZodTypeFactorySelector('unknown'),
                    message: 'Do not use Zod `unknown()` schemas; define an explicit schema instead.',
                },
            ],
        },
    },
];

module.exports = {
    createProteumEslintConfig,
};
