import type { TTraceSummaryValue } from './requestTrace';

export type TDevCommandScope = 'app' | 'framework';
export type TDevCommandSourceLocation = { line: number; column: number };
export type TDevCommandExecutionStatus = 'completed' | 'error';

export type TDevCommandDefinition = {
    path: string;
    className: string;
    methodName: string;
    importPath: string;
    filepath: string;
    sourceLocation: TDevCommandSourceLocation;
    scope: TDevCommandScope;
};

export type TDevCommandSerializedResult = {
    json?: unknown;
    summary: TTraceSummaryValue;
};

export type TDevCommandExecution = {
    command: TDevCommandDefinition;
    startedAt: string;
    finishedAt: string;
    durationMs: number;
    status: TDevCommandExecutionStatus;
    result?: TDevCommandSerializedResult;
    errorMessage?: string;
};

export type TDevCommandListResponse = {
    commands: TDevCommandDefinition[];
};

export type TDevCommandRunResponse = {
    execution: TDevCommandExecution;
};

export type TDevCommandErrorResponse = {
    error: string;
    execution?: TDevCommandExecution;
};

export const normalizeDevCommandPath = (value: string) =>
    value
        .trim()
        .replace(/^\/+/, '')
        .replace(/\/+$/, '')
        .replace(/\/{2,}/g, '/');
