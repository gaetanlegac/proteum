import fs from 'fs-extra';
import mysql from 'mysql2/promise';
import path from 'path';
import { performance } from 'perf_hooks';

import type { Application } from './index';
import type { TDevConsoleLogLevel, TDevConsoleLogsResponse } from '@common/dev/console';
import {
    normalizeDatabaseReadLimit,
    normalizeDatabaseReadTimeoutMs,
    validateDatabaseReadQuery,
    type TDatabaseReadQueryInput,
    type TDatabaseReadQueryResponse,
    type TDatabaseReadQueryRow,
    type TDatabaseReadQueryValue,
} from '@common/dev/database';
import {
    buildDoctorResponse,
    explainSectionNames,
    pickExplainManifestSections,
    type TDoctorResponse,
    type TExplainSectionName,
} from '@common/dev/diagnostics';
import { buildContractsDoctorResponse } from '@common/dev/contractsDoctor';
import {
    buildPerfCompareResponse,
    buildPerfMemoryResponse,
    buildPerfTopResponse,
    resolvePerfRequest,
    type TPerfCompareResponse,
    type TPerfGroupBy,
    type TPerfMemoryResponse,
    type TPerfRequestResponse,
    type TPerfTopResponse,
} from '@common/dev/performance';
import {
    buildDiagnoseResponse,
    explainOwner,
    type TDiagnoseResponse,
    type TExplainOwnerResponse,
} from '@common/dev/inspection';
import type { TProteumManifest } from '@common/dev/proteumManifest';
import type { TRequestTrace } from '@common/dev/requestTrace';
import { parseMariaDbDatabaseUrl } from '@server/services/prisma/mariadb';

const isExplainSectionName = (value: string): value is TExplainSectionName =>
    explainSectionNames.includes(value as TExplainSectionName);
const isConsoleLogLevel = (value: string): value is TDevConsoleLogLevel =>
    ['silly', 'log', 'info', 'warn', 'error'].includes(value);

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

export default class DevDiagnosticsRegistry {
    public constructor(private app: Application) {}

    private getManifestFilepath() {
        return path.join(this.app.container.path.root, '.proteum', 'manifest.json');
    }

    public readManifest(): TProteumManifest {
        const filepath = this.getManifestFilepath();
        if (!fs.existsSync(filepath)) {
            throw new Error(`Proteum manifest not found at ${filepath}. Run a Proteum command that refreshes generated artifacts first.`);
        }

        return fs.readJsonSync(filepath) as TProteumManifest;
    }

    public normalizeExplainSections(rawSections: string[]) {
        const sections = [...new Set(rawSections.map((section) => section.trim()).filter(Boolean))];
        const invalidSections = sections.filter((section) => !isExplainSectionName(section));

        if (invalidSections.length > 0) {
            throw new Error(
                `Unknown explain section(s): ${invalidSections.join(', ')}. Allowed values: ${explainSectionNames.join(', ')}.`,
            );
        }

        return sections as TExplainSectionName[];
    }

    public explain(sectionNames: TExplainSectionName[] = []) {
        return pickExplainManifestSections(this.readManifest(), sectionNames);
    }

    public doctor(strict = false): TDoctorResponse {
        return buildDoctorResponse(this.readManifest(), strict);
    }

    public doctorContracts(strict = false): TDoctorResponse {
        return buildContractsDoctorResponse(this.readManifest(), strict);
    }

    public explainOwner(query: string): TExplainOwnerResponse {
        const normalizedQuery = query.trim();
        if (!normalizedQuery) throw new Error('Owner query is required.');

        return explainOwner(this.readManifest(), normalizedQuery);
    }

    public readLogs(limit = 100, minimumLevel: TDevConsoleLogLevel = 'log'): TDevConsoleLogsResponse {
        return { logs: this.app.container.Console.listLogs(limit, isConsoleLogLevel(minimumLevel) ? minimumLevel : 'log') };
    }

    public async databaseReadQuery({
        limit: rawLimit,
        sql: rawSql,
        timeoutMs: rawTimeoutMs,
    }: TDatabaseReadQueryInput): Promise<TDatabaseReadQueryResponse> {
        const databaseUrl = process.env.DATABASE_URL;
        if (!databaseUrl) throw new Error('DATABASE_URL is required before running database diagnostics.');

        const { kind, sql } = validateDatabaseReadQuery(rawSql);
        const limit = normalizeDatabaseReadLimit(rawLimit);
        const timeoutMs = normalizeDatabaseReadTimeoutMs(rawTimeoutMs);
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
        const startedAt = performance.now();

        try {
            await connection.query('START TRANSACTION READ ONLY');
            const [rows, fields] = await connection.query({ sql, timeout: timeoutMs });
            await connection.rollback();

            const rowList = Array.isArray(rows) ? rows : [];
            const normalizedRows = rowList.map(normalizeDatabaseRow);
            const elapsedMs = Math.max(0, Math.round(performance.now() - startedAt));

            return {
                columns: Array.isArray(fields)
                    ? fields.map((field) => ({
                          name: field.name,
                          table: field.table || undefined,
                          type: field.type,
                      }))
                    : [],
                elapsedMs,
                kind,
                limit,
                limited: normalizedRows.length > limit,
                rowCount: normalizedRows.length,
                rows: normalizedRows.slice(0, limit),
                sql,
            };
        } catch (error) {
            try {
                await connection.rollback();
            } catch (_rollbackError) {}

            throw error;
        } finally {
            await connection.end();
        }
    }

    private resolveRequestTrace({ path, requestId }: { path?: string; requestId?: string }): TRequestTrace | undefined {
        if (requestId) return this.app.container.Trace.getRequest(requestId);
        if (!path) return this.app.container.Trace.getLatestRequest();

        const match = this.app.container.Trace.listRequests(200).find((request) => request.path === path);
        return match ? this.app.container.Trace.getRequest(match.id) : undefined;
    }

    private readPerfRequests() {
        return this.app.container.Trace.listTraceRequests(Number.MAX_SAFE_INTEGER);
    }

    public diagnose({
        logsLevel = 'warn',
        logsLimit = 40,
        path,
        query,
        requestId,
        strict = false,
    }: {
        logsLevel?: TDevConsoleLogLevel;
        logsLimit?: number;
        path?: string;
        query?: string;
        requestId?: string;
        strict?: boolean;
    } = {}): TDiagnoseResponse {
        const manifest = this.readManifest();
        const request = this.resolveRequestTrace({ path, requestId });
        const resolvedQuery = query?.trim() || path?.trim() || request?.path || requestId?.trim() || '';

        if (!resolvedQuery) throw new Error('Diagnose requires a query, path, request id, or an existing latest request trace.');

        return buildDiagnoseResponse({
            contracts: buildContractsDoctorResponse(manifest, strict),
            doctor: buildDoctorResponse(manifest, strict),
            manifest,
            query: resolvedQuery,
            request,
            serverLogs: this.readLogs(logsLimit, logsLevel),
        });
    }

    public perfTop({
        groupBy = 'path',
        limit = 12,
        since = 'today',
    }: {
        groupBy?: TPerfGroupBy;
        limit?: number;
        since?: string;
    } = {}): TPerfTopResponse {
        return buildPerfTopResponse({
            groupBy,
            limit,
            requests: this.readPerfRequests(),
            since,
        });
    }

    public perfCompare({
        baseline = 'yesterday',
        groupBy = 'path',
        limit = 12,
        target = 'today',
    }: {
        baseline?: string;
        groupBy?: TPerfGroupBy;
        limit?: number;
        target?: string;
    } = {}): TPerfCompareResponse {
        return buildPerfCompareResponse({
            baseline,
            groupBy,
            limit,
            requests: this.readPerfRequests(),
            target,
        });
    }

    public perfMemory({
        groupBy = 'path',
        limit = 12,
        since = 'today',
    }: {
        groupBy?: TPerfGroupBy;
        limit?: number;
        since?: string;
    } = {}): TPerfMemoryResponse {
        return buildPerfMemoryResponse({
            groupBy,
            limit,
            requests: this.readPerfRequests(),
            since,
        });
    }

    public perfRequest(requestIdOrPath: string): TPerfRequestResponse {
        return { request: resolvePerfRequest(this.readPerfRequests(), requestIdOrPath, this.readManifest()) };
    }
}
