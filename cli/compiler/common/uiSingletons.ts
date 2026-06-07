type TUiSingletonResolvers = {
    resolvePackageRoot: (packageName: string) => string;
    resolveRequest: (request: string) => string;
};

const uiSingletonPackages = ['preact', 'preact-render-to-string', 'react', 'react-dom'];

const uiSingletonPackageAliases: Array<{ alias: string; packageName: string }> = [
    { alias: 'preact', packageName: 'preact' },
    { alias: 'preact-render-to-string', packageName: 'preact-render-to-string' },
];

const uiSingletonRequestAliases: Array<{ alias: string; request: string }> = [
    { alias: 'preact$', request: 'preact' },
    { alias: 'preact/hooks$', request: 'preact/hooks' },
    { alias: 'preact/compat$', request: 'preact/compat' },
    { alias: 'preact/compat/client$', request: 'preact/compat/client' },
    { alias: 'preact/jsx-runtime$', request: 'preact/jsx-runtime' },
    { alias: 'preact/jsx-dev-runtime$', request: 'preact/jsx-dev-runtime' },
    { alias: 'react$', request: 'preact/compat' },
    { alias: 'react-dom$', request: 'preact/compat' },
    { alias: 'react-dom/client$', request: 'preact/compat/client' },
    { alias: 'react-dom/test-utils$', request: 'preact/test-utils' },
    { alias: 'react/jsx-runtime$', request: 'preact/jsx-runtime' },
    { alias: 'react/jsx-dev-runtime$', request: 'preact/jsx-dev-runtime' },
    { alias: 'preact-render-to-string$', request: 'preact-render-to-string' },
];

const uiSingletonServerExternalRequests: Array<{ request: string; resolvedRequest: string }> = [
    { request: 'preact', resolvedRequest: 'preact' },
    { request: 'preact/hooks', resolvedRequest: 'preact/hooks' },
    { request: 'preact/compat', resolvedRequest: 'preact/compat' },
    { request: 'preact/compat/client', resolvedRequest: 'preact/compat/client' },
    { request: 'preact/jsx-runtime', resolvedRequest: 'preact/jsx-runtime' },
    { request: 'preact/jsx-dev-runtime', resolvedRequest: 'preact/jsx-dev-runtime' },
    { request: 'preact/test-utils', resolvedRequest: 'preact/test-utils' },
    { request: 'react', resolvedRequest: 'preact/compat' },
    { request: 'react-dom', resolvedRequest: 'preact/compat' },
    { request: 'react-dom/client', resolvedRequest: 'preact/compat/client' },
    { request: 'react-dom/test-utils', resolvedRequest: 'preact/test-utils' },
    { request: 'react/jsx-runtime', resolvedRequest: 'preact/jsx-runtime' },
    { request: 'react/jsx-dev-runtime', resolvedRequest: 'preact/jsx-dev-runtime' },
];

export const isUiSingletonRequest = (request: string | undefined) =>
    typeof request === 'string' &&
    uiSingletonPackages.some((packageName) => request === packageName || request.startsWith(`${packageName}/`));

export const resolveUiSingletonAliases = ({ resolvePackageRoot, resolveRequest }: TUiSingletonResolvers) => ({
    ...Object.fromEntries(
        uiSingletonRequestAliases.map(({ alias, request }) => [
            alias,
            resolveRequest(request),
        ]),
    ),
    ...Object.fromEntries(
        uiSingletonPackageAliases.map(({ alias, packageName }) => [
            alias,
            resolvePackageRoot(packageName),
        ]),
    ),
});

export const resolveUiSingletonServerExternalRequest = (
    request: string | undefined,
    resolveRequest: TUiSingletonResolvers['resolveRequest'],
) => {
    if (request === undefined) return undefined;

    const exactExternalRequest = uiSingletonServerExternalRequests.find((entry) => entry.request === request);
    if (exactExternalRequest) return resolveRequest(exactExternalRequest.resolvedRequest);

    if (request.startsWith('preact/')) return resolveRequest(request);

    return undefined;
};
