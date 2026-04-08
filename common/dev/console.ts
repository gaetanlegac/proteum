/*----------------------------------
- TYPES
----------------------------------*/

import type { TTraceCallOrigin, TTraceSqlQueryKind } from './requestTrace';

export type TDevConsoleLogLevel = 'silly' | 'log' | 'info' | 'warn' | 'error';

export type TDevConsoleLogChannel = {
    channelType: 'cron' | 'master' | 'request' | 'socket';
    channelId?: string;
    silentLogs?: boolean;
    method?: string;
    path?: string;
    user?: string;
    connectedNamespace?: string;
    ownerLabel?: string;
    ownerFilepath?: string;
    serviceLabel?: string;
    cacheKey?: string;
    cachePhase?: string;
    traceCallId?: string;
    traceCallOrigin?: TTraceCallOrigin;
    traceCallLabel?: string;
    traceCallFetcherId?: string;
    prismaOperations?: Array<{ kind: TTraceSqlQueryKind; model?: string; operation: string }>;
};

export type TDevConsoleLogEntry = {
    channel: TDevConsoleLogChannel;
    level: TDevConsoleLogLevel;
    text: string;
    time: string;
};

export type TDevConsoleLogsResponse = {
    logs: TDevConsoleLogEntry[];
};
