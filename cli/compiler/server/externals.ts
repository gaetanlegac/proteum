type TResolveRequestOptions = { preferApp: boolean };

type TResolveServerExternalRequestOptions = {
    context?: string;
    frameworkRoots: string[];
    request: string;
    resolveRequest: (request: string, options: TResolveRequestOptions) => string;
};

const normalizeModulePath = (value?: string) => (value || '').replace(/\\/g, '/');

export const isFrameworkSourceContext = (context: string | undefined, frameworkRoots: string[]) => {
    const normalizedContext = normalizeModulePath(context);

    return frameworkRoots.some((rootPath) => {
        const normalizedRootPath = normalizeModulePath(rootPath);

        return normalizedContext === normalizedRootPath || normalizedContext.startsWith(normalizedRootPath + '/');
    });
};

export const resolveServerExternalRequest = ({
    context,
    frameworkRoots,
    request,
    resolveRequest,
}: TResolveServerExternalRequestOptions) => {
    try {
        return resolveRequest(request, {
            preferApp: !isFrameworkSourceContext(context, frameworkRoots),
        });
    } catch {
        return request;
    }
};
