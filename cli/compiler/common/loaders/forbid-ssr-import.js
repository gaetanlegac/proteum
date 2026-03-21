'use strict';

module.exports = function forbidSsrImportLoader() {
    const resourcePath = this.resourcePath || this.request || '<unknown>';

    throw new Error(
        [
            'SSR-only module imported into the client bundle:',
            resourcePath,
            'Provide the browser implementation without the ".ssr" suffix and keep SSR-specific logic in "*.ssr.tsx" files.',
        ].join('\n'),
    );
};
