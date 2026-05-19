import mysql from 'mysql2/promise';
import { Client as PostgresClient } from 'pg';
import { performance } from 'perf_hooks';

import type {
    TDatabaseReadQueryColumn,
    TDatabaseReadQueryResponse,
    TDatabaseReadQueryRow,
    TDatabaseReadQueryValue,
} from '@common/dev/database';
import { parseMariaDbDatabaseUrl } from '@server/services/prisma/mariadb';

type TDatabaseProtocol = 'mariadb' | 'postgresql';

const normalizeDatabaseValue = (value: unknown): TDatabaseReadQueryValue => {
    if (value === null || value === undefined) return null;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
    if (typeof value === 'bigint') return value.toString();
    if (value instanceof Date) return value.toISOString();
    if (Buffer.isBuffer(value)) return `[Buffer ${value.byteLength} bytes]`;

    return JSON.stringify(value);
};

const normalizeDatabaseRow = (row: unknown): TDatabaseReadQueryRow => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) return {};

    return Object.fromEntries(
        Object.entries(row).map(([key, value]) => [key, normalizeDatabaseValue(value)]),
    ) as TDatabaseReadQueryRow;
};

export const databaseProtocolFromUrl = (databaseUrl: string): TDatabaseProtocol => {
    const { protocol } = new URL(databaseUrl);

    if (protocol === 'mysql:' || protocol === 'mariadb:') return 'mariadb';
    if (protocol === 'postgres:' || protocol === 'postgresql:') return 'postgresql';

    throw new Error(
        `Unsupported DATABASE_URL protocol "${protocol}". Proteum database diagnostics support mysql://, mariadb://, postgres://, and postgresql://.`,
    );
};

const columnsFromMariaDbFields = (fields: unknown): TDatabaseReadQueryColumn[] =>
    Array.isArray(fields)
        ? fields.map((field) => {
              const candidate = field as { name?: unknown; table?: unknown; type?: unknown };

              return {
                  name: typeof candidate.name === 'string' ? candidate.name : '',
                  ...(typeof candidate.table === 'string' && candidate.table ? { table: candidate.table } : {}),
                  ...(typeof candidate.type === 'number' || typeof candidate.type === 'string' ? { type: candidate.type } : {}),
              };
          })
        : [];

const readMariaDb = async ({
    databaseUrl,
    limit,
    sql,
    timeoutMs,
}: {
    databaseUrl: string;
    limit: number;
    sql: string;
    timeoutMs: number;
}) => {
    const connectionConfig = parseMariaDbDatabaseUrl(databaseUrl);
    const connection = await mysql.createConnection({
        host: connectionConfig.host,
        port: connectionConfig.port,
        user: connectionConfig.user,
        password: connectionConfig.password,
        database: connectionConfig.database,
        connectTimeout: connectionConfig.connectTimeout,
        multipleStatements: false,
        supportBigNumbers: true,
        bigNumberStrings: true,
        dateStrings: true,
    });

    try {
        await connection.query('START TRANSACTION READ ONLY');
        const [rows, fields] = await connection.query({ sql, timeout: timeoutMs });
        await connection.rollback();

        const rowList = Array.isArray(rows) ? rows : [];
        const normalizedRows = rowList.map(normalizeDatabaseRow);

        return {
            columns: columnsFromMariaDbFields(fields),
            limited: normalizedRows.length > limit,
            rowCount: normalizedRows.length,
            rows: normalizedRows.slice(0, limit),
        };
    } catch (error) {
        try {
            await connection.rollback();
        } catch (_rollbackError) {}

        throw error;
    } finally {
        await connection.end();
    }
};

const readPostgreSql = async ({
    databaseUrl,
    limit,
    sql,
    timeoutMs,
}: {
    databaseUrl: string;
    limit: number;
    sql: string;
    timeoutMs: number;
}) => {
    const client = new PostgresClient({
        connectionString: databaseUrl,
        statement_timeout: timeoutMs,
        query_timeout: timeoutMs,
    });

    try {
        await client.connect();
        await client.query('BEGIN READ ONLY');
        await client.query('SET TRANSACTION READ ONLY');
        const result = await client.query(sql);
        await client.query('ROLLBACK');

        const normalizedRows = result.rows.map(normalizeDatabaseRow);

        return {
            columns: result.fields.map((field) => ({
                name: field.name,
                ...(field.tableID ? { table: String(field.tableID) } : {}),
                type: field.dataTypeID,
            })),
            limited: normalizedRows.length > limit,
            rowCount: normalizedRows.length,
            rows: normalizedRows.slice(0, limit),
        };
    } catch (error) {
        try {
            await client.query('ROLLBACK');
        } catch (_rollbackError) {}

        throw error;
    } finally {
        try {
            await client.end();
        } catch (_endError) {}
    }
};

export const runDatabaseReadQuery = async ({
    databaseUrl,
    kind,
    limit,
    sql,
    timeoutMs,
}: {
    databaseUrl: string;
    kind: TDatabaseReadQueryResponse['kind'];
    limit: number;
    sql: string;
    timeoutMs: number;
}): Promise<TDatabaseReadQueryResponse> => {
    const startedAt = performance.now();
    const response =
        databaseProtocolFromUrl(databaseUrl) === 'postgresql'
            ? await readPostgreSql({ databaseUrl, limit, sql, timeoutMs })
            : await readMariaDb({ databaseUrl, limit, sql, timeoutMs });
    const elapsedMs = Math.max(0, Math.round(performance.now() - startedAt));

    return {
        ...response,
        elapsedMs,
        kind,
        limit,
        sql,
    };
};
