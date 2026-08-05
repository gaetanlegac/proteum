export type TDevSessionUserSummary = {
    email: string;
    name: string | null;
    type: string;
    roles: string[];
    locale?: string | null;
};

export type TDevSessionPayload = {
    token: string;
    cookieName: 'authorization';
    expiresInMs: number;
    issuedAt: string;
    expiresAt: string;
};

export type TDevSessionStartResponse = {
    user: TDevSessionUserSummary;
    session: TDevSessionPayload;
};

export type TDevSessionErrorResponse = {
    error: string;
};

export const devSessionLoginPath = '/__proteum/session/login';
export const devSessionStartPath = '/__proteum/session/start';

export const normalizeDevSessionRedirectPath = (value: string): string => {
    const redirect = value.trim() || '/';
    if (!redirect.startsWith('/') || redirect.startsWith('//') || redirect.startsWith('/\\') || /[\r\n]/.test(redirect)) {
        throw new Error('Redirect must be a local absolute path such as /dashboard.');
    }

    return redirect;
};

export const buildDevSessionLoginUrl = ({
    baseUrl,
    email,
    redirect,
    role,
}: {
    baseUrl: string;
    email: string;
    redirect: string;
    role?: string;
}): string => {
    const params = new URLSearchParams({
        email,
        redirect: normalizeDevSessionRedirectPath(redirect),
    });
    if (role?.trim()) params.set('role', role.trim());

    return `${baseUrl.replace(/\/+$/, '')}${devSessionLoginPath}?${params.toString()}`;
};
