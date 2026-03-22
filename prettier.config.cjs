module.exports = {
    tabWidth: 4,
    printWidth: 120,
    singleQuote: true,
    jsxSingleQuote: false,
    semi: true,
    trailingComma: 'all',
    objectWrap: 'preserve',
    plugins: [require.resolve('./prettier/router-registration-plugin.cjs')],
};
