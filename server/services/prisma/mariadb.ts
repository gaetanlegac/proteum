import { PrismaMariaDb } from '@prisma/adapter-mariadb';

const defaultConnectTimeout = 5_000;
const defaultIdleTimeout = 300;
const defaultPort = 3306;

const parseInteger = (value: string | null | undefined) => {
    if (!value) return undefined;

    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return undefined;

    return parsed;
};

const decodeUrlSegment = (value: string) => {
    if (!value) return value;

    return decodeURIComponent(value);
};

export const createMariaDbAdapter = (databaseUrl: string) => {
    const url = new URL(databaseUrl);

    if (url.protocol !== 'mysql:' && url.protocol !== 'mariadb:')
        throw new Error(
            `Unsupported DATABASE_URL protocol "${url.protocol}". Prisma 7 Proteum support expects mysql:// or mariadb://.`,
        );

    const database = url.pathname.replace(/^\/+/, '');
    if (!database) throw new Error('DATABASE_URL must include a database name.');

    const connectionLimit = parseInteger(url.searchParams.get('connection_limit'));
    const connectTimeoutSeconds = parseInteger(url.searchParams.get('connect_timeout'));
    const idleTimeoutSeconds = parseInteger(url.searchParams.get('max_idle_connection_lifetime'));

    return new PrismaMariaDb({
        host: url.hostname,
        port: parseInteger(url.port) ?? defaultPort,
        user: decodeUrlSegment(url.username),
        password: decodeUrlSegment(url.password),
        database: decodeUrlSegment(database),
        connectTimeout: connectTimeoutSeconds ? connectTimeoutSeconds * 1_000 : defaultConnectTimeout,
        idleTimeout: idleTimeoutSeconds ?? defaultIdleTimeout,
        ...(connectionLimit !== undefined ? { connectionLimit } : {}),
    });
};
