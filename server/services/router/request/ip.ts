/*----------------------------------
- DEPENDANCES
----------------------------------*/

// Npm
import type express from 'express';
import { isIP } from 'net';

/*----------------------------------
- TYPES
----------------------------------*/

type THeaderValue = string | string[] | undefined;

/*----------------------------------
- CONSTANTS
----------------------------------*/

const trustedClientIpHeaders = ['cf-connecting-ip', 'true-client-ip', 'fastly-client-ip'] as const;
const bracketedIpPattern = /^\[([^\]]+)\](?::\d+)?$/;
const ipv4WithPortPattern = /^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/;
const ipv4MappedIpv6Pattern = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i;

/*----------------------------------
- HELPERS
----------------------------------*/

const readHeader = (headers: Record<string, THeaderValue>, name: string): string | null => {
    const normalizedName = name.toLowerCase();
    const directValue = headers[name] ?? headers[normalizedName] ?? headers[name.toUpperCase()];
    const value =
        directValue !== undefined
            ? directValue
            : Object.entries(headers).find(([key]) => key.toLowerCase() === normalizedName)?.[1];

    if (Array.isArray(value)) {
        const firstValue = value.find((entry) => typeof entry === 'string' && entry.trim());
        return typeof firstValue === 'string' ? firstValue.trim() : null;
    }

    return typeof value === 'string' && value.trim() ? value.trim() : null;
};

export const normalizeRequestIpCandidate = (value: string | null | undefined): string | null => {
    let candidate = typeof value === 'string' ? value.trim() : '';
    if (!candidate) return null;

    const bracketedIp = bracketedIpPattern.exec(candidate);
    if (bracketedIp) candidate = bracketedIp[1].trim();

    const ipv4MappedIpv6 = ipv4MappedIpv6Pattern.exec(candidate);
    if (ipv4MappedIpv6 && isIP(ipv4MappedIpv6[1]) === 4) {
        candidate = ipv4MappedIpv6[1];
    } else {
        const ipv4WithPort = ipv4WithPortPattern.exec(candidate);
        if (ipv4WithPort && isIP(ipv4WithPort[1]) === 4) candidate = ipv4WithPort[1];
    }

    return isIP(candidate) ? candidate : null;
};

export const resolveRequestIp = (req: Pick<express.Request, 'headers' | 'ip'>): string | undefined => {
    const headers = req.headers as Record<string, THeaderValue>;

    for (const headerName of trustedClientIpHeaders) {
        const ip = normalizeRequestIpCandidate(readHeader(headers, headerName));
        if (ip) return ip;
    }

    return normalizeRequestIpCandidate(req.ip) || undefined;
};
