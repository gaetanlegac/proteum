import fs from 'fs-extra';
import path from 'path';

import type { Application } from './index';
import type { TDevConsoleLogLevel, TDevConsoleLogsResponse } from '@common/dev/console';
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

const isExplainSectionName = (value: string): value is TExplainSectionName =>
    explainSectionNames.includes(value as TExplainSectionName);
const isConsoleLogLevel = (value: string): value is TDevConsoleLogLevel =>
    ['silly', 'log', 'info', 'warn', 'error'].includes(value);

export default class DevDiagnosticsRegistry<TApplication extends Application = Application> {
    public constructor(private app: TApplication) {}

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
