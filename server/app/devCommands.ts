import type { Application } from './index';
import type { Commands } from './commands';
import { normalizeDevCommandPath, type TDevCommandDefinition, type TDevCommandExecution } from '@common/dev/commands';
import type { TTraceSummaryValue } from '@common/dev/requestTrace';
import { NotFound } from '@common/errors';

export type TGeneratedCommandDefinition = TDevCommandDefinition & {
    Command: new (app: Application) => Commands<any>;
};

type TSerializableValue = object | PrimitiveValue | bigint | symbol | null | undefined | (() => void);

const maxSummaryStringLength = 240;
const sensitiveKeyPattern =
    /(^|\.)(authorization|cookie|set-cookie|password|pass|pwd|secret|token|refreshToken|accessToken|apiKey|apiSecret|secretAccessKey|accessKeyId|privateKey|session|jwt|rawBody)$/i;

const nowIso = () => new Date().toISOString();
const getDurationMs = (startedAt: string, finishedAt: string) => Math.max(0, Date.parse(finishedAt) - Date.parse(startedAt));
const isSensitiveKeyPath = (keyPath: string[]) => sensitiveKeyPattern.test(keyPath.join('.'));
const summarizeString = (value: string) =>
    value.length <= maxSummaryStringLength ? value : `${value.slice(0, maxSummaryStringLength)}…`;

const summarizeError = (error: Error): TTraceSummaryValue => ({
    kind: 'error',
    name: error.name,
    message: error.message,
    stack: error.stack?.split('\n').slice(0, 5).join('\n'),
});

const summarizeValue = (
    value: TSerializableValue,
    depth: number,
    seen: WeakSet<object>,
    keyPath: string[],
): TTraceSummaryValue => {
    if (isSensitiveKeyPath(keyPath)) return { kind: 'redacted', reason: `Sensitive key ${keyPath[keyPath.length - 1] || 'value'}` };
    if (value === undefined) return { kind: 'undefined' };
    if (value === null) return null;

    if (typeof value === 'string') return summarizeString(value);
    if (typeof value === 'number' || typeof value === 'boolean') return value;
    if (typeof value === 'bigint') return { kind: 'bigint', value: value.toString() };
    if (typeof value === 'symbol') return { kind: 'symbol', value: value.toString() };
    if (typeof value === 'function') return { kind: 'function', name: value.name || 'anonymous' };

    if (value instanceof Date) return { kind: 'date', value: value.toISOString() };
    if (value instanceof Error) return summarizeError(value);
    if (Buffer.isBuffer(value)) return { kind: 'buffer', byteLength: value.byteLength };
    if (value instanceof Map) return { kind: 'map', size: value.size };
    if (value instanceof Set) return { kind: 'set', size: value.size };

    if (seen.has(value)) {
        return {
            kind: 'object',
            constructorName: value.constructor?.name || 'Object',
            keys: [],
            entries: {},
            truncated: true,
        };
    }

    seen.add(value);

    if (Array.isArray(value)) {
        if (depth <= 0) return { kind: 'array', length: value.length, items: [], truncated: value.length > 0 };

        const items = value
            .slice(0, 10)
            .map((item, index) => summarizeValue(item as TSerializableValue, depth - 1, seen, [...keyPath, `[${index}]`]));

        return { kind: 'array', length: value.length, items, truncated: value.length > items.length };
    }

    const constructorName = value.constructor?.name || 'Object';
    const keys = Object.keys(value);
    if (depth <= 0) {
        return { kind: 'object', constructorName, keys, entries: {}, truncated: keys.length > 0 };
    }

    const entries: { [key: string]: TTraceSummaryValue } = {};
    for (const key of keys.slice(0, 20)) {
        const record = value as Record<string, TSerializableValue>;
        entries[key] = summarizeValue(record[key], depth - 1, seen, [...keyPath, key]);
    }

    return { kind: 'object', constructorName, keys, entries, truncated: keys.length > Object.keys(entries).length };
};

const serializeJsonResult = (value: unknown) => {
    if (value === undefined) return undefined;

    try {
        return JSON.parse(JSON.stringify(value)) as unknown;
    } catch {
        return undefined;
    }
};

export class DevCommandExecutionError extends Error {
    public constructor(
        message: string,
        public execution: TDevCommandExecution,
        public cause?: unknown,
    ) {
        super(message);
        this.name = 'DevCommandExecutionError';
    }
}

const loadGeneratedCommandDefinitions = () =>
    (((require('@generated/server/commands') as { default?: TGeneratedCommandDefinition[] }).default || []) as TGeneratedCommandDefinition[]).sort(
        (a, b) => a.path.localeCompare(b.path),
    );

export default class DevCommandsRegistry<TApplication extends Application = Application> {
    private definitions = loadGeneratedCommandDefinitions();

    public constructor(private app: TApplication) {}

    public list() {
        return this.definitions.map((definition) => ({
            path: definition.path,
            className: definition.className,
            methodName: definition.methodName,
            importPath: definition.importPath,
            filepath: definition.filepath,
            sourceLocation: definition.sourceLocation,
            scope: definition.scope,
        }));
    }

    private getDefinition(commandPath: string) {
        const normalizedPath = normalizeDevCommandPath(commandPath);
        const matchingDefinitions = this.definitions.filter((definition) => definition.path === normalizedPath);

        if (matchingDefinitions.length === 0) {
            throw new NotFound(`Command "${normalizedPath}" was not found.`);
        }

        if (matchingDefinitions.length > 1) {
            throw new Error(`Command "${normalizedPath}" is ambiguous because it is registered more than once.`);
        }

        return matchingDefinitions[0];
    }

    public async run(commandPath: string): Promise<TDevCommandExecution> {
        const definition = this.getDefinition(commandPath);
        const startedAt = nowIso();

        try {
            const instance = new definition.Command(this.app);
            const method = (instance as Record<string, unknown>)[definition.methodName];

            if (typeof method !== 'function') {
                throw new Error(
                    `Command "${definition.path}" could not be executed because ${definition.className}.${definition.methodName} is not callable.`,
                );
            }

            const value = await method.call(instance);
            const finishedAt = nowIso();

            return {
                command: this.list().find((command) => command.path === definition.path) || definition,
                startedAt,
                finishedAt,
                durationMs: getDurationMs(startedAt, finishedAt),
                status: 'completed',
                result:
                    value === undefined
                        ? undefined
                        : {
                              json: serializeJsonResult(value),
                              summary: summarizeValue(value as TSerializableValue, 3, new WeakSet<object>(), ['result']),
                          },
            };
        } catch (error) {
            const finishedAt = nowIso();
            const execution: TDevCommandExecution = {
                command: this.list().find((command) => command.path === definition.path) || definition,
                startedAt,
                finishedAt,
                durationMs: getDurationMs(startedAt, finishedAt),
                status: 'error',
                errorMessage: error instanceof Error ? error.message : String(error),
            };

            throw new DevCommandExecutionError(execution.errorMessage || `Command "${definition.path}" failed.`, execution, error);
        }
    }
}
