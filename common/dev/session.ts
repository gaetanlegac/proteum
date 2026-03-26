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
