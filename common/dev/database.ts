export type TDatabaseReadQueryKind = 'explain' | 'select' | 'show';

export type TDatabaseReadQueryInput = {
    limit?: number;
    sql: string;
    timeoutMs?: number;
};

export type TDatabaseReadQueryColumn = {
    name: string;
    table?: string;
    type?: number | string;
};

export type TDatabaseReadQueryValue = boolean | number | string | null;

export type TDatabaseReadQueryRow = Record<string, TDatabaseReadQueryValue>;

export type TDatabaseReadQueryResponse = {
    columns: TDatabaseReadQueryColumn[];
    elapsedMs: number;
    kind: TDatabaseReadQueryKind;
    limit: number;
    limited: boolean;
    rowCount: number;
    rows: TDatabaseReadQueryRow[];
    sql: string;
};

export type TValidatedDatabaseReadQuery = {
    kind: TDatabaseReadQueryKind;
    sql: string;
};

export const defaultDatabaseReadLimit = 50;
export const maxDatabaseReadLimit = 500;
export const defaultDatabaseReadTimeoutMs = 5_000;
export const maxDatabaseReadTimeoutMs = 30_000;

const allowedQueryKinds = new Set<TDatabaseReadQueryKind>(['explain', 'select', 'show']);
const sqlKeywordPattern = /^[A-Za-z]+/;
const sqlCommentPattern = /\/\*[\s\S]*?\*\//g;
const sqlLineCommentPattern = /(?:^|\n)\s*(?:--|#).*?(?=\n|$)/g;

const clampInteger = ({ fallback, max, min, value }: { fallback: number; max: number; min: number; value?: number }) => {
    if (value === undefined || !Number.isInteger(value) || value < min) return fallback;

    return Math.min(value, max);
};

export const normalizeDatabaseReadLimit = (limit?: number) =>
    clampInteger({
        fallback: defaultDatabaseReadLimit,
        max: maxDatabaseReadLimit,
        min: 1,
        value: limit,
    });

export const normalizeDatabaseReadTimeoutMs = (timeoutMs?: number) =>
    clampInteger({
        fallback: defaultDatabaseReadTimeoutMs,
        max: maxDatabaseReadTimeoutMs,
        min: 100,
        value: timeoutMs,
    });

const skipLeadingTrivia = (sql: string) => {
    let index = 0;

    while (index < sql.length) {
        const char = sql[index];
        const next = sql[index + 1];

        if (/\s/.test(char)) {
            index += 1;
            continue;
        }

        if (char === '-' && next === '-') {
            index = sql.indexOf('\n', index + 2);
            if (index === -1) return sql.length;
            continue;
        }

        if (char === '#') {
            index = sql.indexOf('\n', index + 1);
            if (index === -1) return sql.length;
            continue;
        }

        if (char === '/' && next === '*') {
            const end = sql.indexOf('*/', index + 2);
            if (end === -1) throw new Error('SQL contains an unterminated block comment.');
            index = end + 2;
            continue;
        }

        return index;
    }

    return index;
};

const stripSqlComments = (sql: string) =>
    sql.replace(sqlCommentPattern, ' ').replace(sqlLineCommentPattern, '\n');

const findFirstStatementEnd = (sql: string) => {
    let quote: "'" | '"' | '`' | undefined;
    let lineComment = false;
    let blockComment = false;

    for (let index = 0; index < sql.length; index += 1) {
        const char = sql[index];
        const next = sql[index + 1];

        if (lineComment) {
            if (char === '\n') lineComment = false;
            continue;
        }

        if (blockComment) {
            if (char === '*' && next === '/') {
                blockComment = false;
                index += 1;
            }
            continue;
        }

        if (quote) {
            if (char === '\\') {
                index += 1;
                continue;
            }
            if (char === quote) quote = undefined;
            continue;
        }

        if (char === '-' && next === '-') {
            lineComment = true;
            index += 1;
            continue;
        }

        if (char === '#') {
            lineComment = true;
            continue;
        }

        if (char === '/' && next === '*') {
            blockComment = true;
            index += 1;
            continue;
        }

        if (char === '\'' || char === '"' || char === '`') {
            quote = char;
            continue;
        }

        if (char === ';') return index;
    }

    if (quote) throw new Error('SQL contains an unterminated quoted string.');
    if (blockComment) throw new Error('SQL contains an unterminated block comment.');

    return -1;
};

const assertSingleStatement = (sql: string) => {
    const end = findFirstStatementEnd(sql);
    if (end === -1) return sql.trim();

    const first = sql.slice(0, end).trim();
    const rest = stripSqlComments(sql.slice(end + 1)).trim();
    if (rest) throw new Error('Only one read-only SQL statement may be executed.');

    return first;
};

const getReadQueryKind = (sql: string): TDatabaseReadQueryKind => {
    const start = skipLeadingTrivia(sql);
    const keyword = sql.slice(start).match(sqlKeywordPattern)?.[0]?.toLowerCase();

    if (!keyword || !allowedQueryKinds.has(keyword as TDatabaseReadQueryKind)) {
        throw new Error('Only SELECT, SHOW, and EXPLAIN SQL statements are allowed.');
    }

    return keyword as TDatabaseReadQueryKind;
};

const assertAllowedReadQueryShape = (sql: string) => {
    const normalized = stripSqlComments(sql).replace(/\s+/g, ' ').trim().toLowerCase();

    if (/\bexplain\s+analyze\b/.test(normalized)) {
        throw new Error('EXPLAIN ANALYZE is not allowed because it executes the target query.');
    }

    if (/\binto\s+(?:out|dump)file\b/.test(normalized)) {
        throw new Error('SELECT INTO OUTFILE and SELECT INTO DUMPFILE are not allowed.');
    }

    if (/\b(?:load_file|pg_read_file|pg_read_binary_file|pg_ls_dir)\s*\(/.test(normalized)) {
        throw new Error('Database file-read functions are not allowed in database diagnostics.');
    }

    if (
        /\bfor\s+(?:update|no\s+key\s+update|share|key\s+share)\b/.test(normalized) ||
        /\block\s+in\s+share\s+mode\b/.test(normalized)
    ) {
        throw new Error('Locking read statements are not allowed in database diagnostics.');
    }

    if (/\b(?:sleep|benchmark|pg_sleep|pg_sleep_for|pg_sleep_until)\s*\(/.test(normalized)) {
        throw new Error('Sleep and benchmark functions are not allowed in database diagnostics.');
    }
};

export const validateDatabaseReadQuery = (rawSql: string): TValidatedDatabaseReadQuery => {
    const normalizedSql = rawSql.replace(/^\uFEFF/, '').trim();
    if (!normalizedSql) throw new Error('SQL query is required.');
    if (normalizedSql.length > 20_000) throw new Error('SQL query is too long for database diagnostics.');

    const sql = assertSingleStatement(normalizedSql);
    const kind = getReadQueryKind(sql);

    assertAllowedReadQueryShape(sql);

    return { kind, sql };
};
