/*----------------------------------
- DEPENDANCES
----------------------------------*/

// Npm
import dotenv from 'dotenv';
import { Prisma, PrismaClient } from '@generated/server/models';
import mysql from 'mysql2/promise';
const safeStringify = require('fast-safe-stringify'); // remplace les références circulairs par un [Circular]

// Core
import type { Application } from '@server/app/index';
import type { ChannelInfos } from '@server/app/container/console';
import Service, { TServiceArgs } from '@server/app/service';
import context from '@server/context';

// Specific
import Facet, { TDelegate, TSubset, Transform } from './Facet';
import { createMariaDbAdapter } from './mariadb';
import { NotFound } from '@common/errors';

/*----------------------------------
- TYPES
----------------------------------*/

export type SqlQuery = ReturnType<ModelsManager['SQL']>;

type DecimalLike = {
    constructor?: { name?: string };
    equals: (value: number) => boolean;
    toNumber: () => number;
    toString: () => string;
};
type TPrismaOperationContext = { kind: 'orm' | 'raw'; model?: string; operation: string };
type TPrismaQueryEvent = {
    duration: number;
    params: string;
    query: string;
    target: string;
    timestamp: Date;
};
type TPrismaExtensionOperation = {
    args: unknown;
    model?: string;
    operation: string;
    query: (args: unknown) => Promise<unknown>;
};

/*----------------------------------
- HELPERS
----------------------------------*/

const isDecimalLike = (value: object): value is DecimalLike =>
    'constructor' in value &&
    'equals' in value &&
    'toNumber' in value &&
    'toString' in value &&
    typeof value.constructor === 'function' &&
    value.constructor.name === 'Decimal' &&
    typeof value.equals === 'function' &&
    typeof value.toNumber === 'function' &&
    typeof value.toString === 'function';

const isPlainObject = (value: object) => {
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
};

const normalizeBigInt = (value: bigint) => {
    const number = Number(value);
    return Number.isSafeInteger(number) ? number : value.toString();
};

const normalizeDecimal = (value: DecimalLike) => {
    const number = value.toNumber();
    return Number.isFinite(number) && value.equals(number) ? number : value.toString();
};

const normalizeSqlScalar = (value: bigint | DecimalLike) =>
    typeof value === 'bigint' ? normalizeBigInt(value) : normalizeDecimal(value);

const normalizeSqlResult = <T>(value: T): T => {
    if (typeof value === 'bigint') return normalizeSqlScalar(value) as T;

    if (Array.isArray(value)) return value.map((item) => normalizeSqlResult(item)) as T;

    if (value === null || value === undefined || typeof value !== 'object' || value instanceof Date) return value;

    if (isDecimalLike(value)) return normalizeSqlScalar(value) as T;

    if (!isPlainObject(value)) return value;

    return Object.fromEntries(
        Object.entries(value).map(([key, nestedValue]) => [key, normalizeSqlResult(nestedValue)]),
    ) as T;
};
const rawOperationNames = new Set([
    '$executeRaw',
    '$executeRawUnsafe',
    '$queryRaw',
    '$queryRawUnsafe',
    'aggregateRaw',
    'executeRaw',
    'findRaw',
    'queryRaw',
    'runCommandRaw',
]);

const inferPrismaOperationKind = (model: string | undefined, operation: string): TPrismaOperationContext['kind'] =>
    rawOperationNames.has(operation) || operation.toLowerCase().includes('raw') ? 'raw' : model ? 'orm' : 'raw';

const parseQueryParams = (value: string) => {
    if (!value) return undefined;

    try {
        return JSON.parse(value);
    } catch (_error) {
        return undefined;
    }
};

const withPrismaOperationContext = async <T>(meta: TPrismaOperationContext, execute: () => Promise<T>) => {
    const store = context.getStore() as ChannelInfos | undefined;
    if (!store) return execute();

    const operations = store.prismaOperations || (store.prismaOperations = []);
    operations.push(meta);

    try {
        return await execute();
    } finally {
        const lastOperation = operations[operations.length - 1];
        if (lastOperation === meta) operations.pop();
        else {
            const operationIndex = operations.lastIndexOf(meta);
            if (operationIndex !== -1) operations.splice(operationIndex, 1);
        }

        if (operations.length === 0) delete store.prismaOperations;
    }
};

/*----------------------------------
- SERVICE CONFIG
----------------------------------*/

export type Config = { debug?: boolean };

export type Hooks = {};

export type Services = {};

// Fix: Do not know how to serialize a BigInt
BigInt.prototype.toJSON = function () {
    return normalizeBigInt(this.valueOf());
};

/*----------------------------------
- CLASSE
----------------------------------*/

export default class ModelsManager extends Service<Config, Hooks, Application, Application> {
    public client: PrismaClient;

    public constructor(...args: TServiceArgs<ModelsManager>) {
        super(...args);

        dotenv.config({ quiet: true });

        const databaseUrl = process.env.DATABASE_URL;
        if (!databaseUrl)
            throw new Error(
                'DATABASE_URL is required before starting the Models service. Prisma 7 no longer auto-loads runtime env files.',
            );

        const shouldTraceQueries = this.app.container.Trace.isEnabled();
        const prismaClient = shouldTraceQueries
            ? new PrismaClient({
                  adapter: createMariaDbAdapter(databaseUrl),
                  log: [{ emit: 'event', level: 'query' }],
              })
            : new PrismaClient({
                  adapter: createMariaDbAdapter(databaseUrl),
              });

        if (!shouldTraceQueries) {
            this.client = prismaClient;
            return;
        }

        prismaClient.$on('query', (event: TPrismaQueryEvent) => this.traceQuery(event));

        this.client = prismaClient.$extends(
            Prisma.defineExtension({
                query: {
                    async $allOperations({ args, model, operation, query }: TPrismaExtensionOperation) {
                        const normalizedModel = typeof model === 'string' ? model : undefined;
                        return withPrismaOperationContext(
                            {
                                kind: inferPrismaOperationKind(normalizedModel, operation),
                                model: normalizedModel,
                                operation,
                            },
                            () => query(args),
                        );
                    },
                },
            }),
        ) as PrismaClient;
    }

    public async ready() {
        await this.client.$executeRaw`SET time_zone = '+00:00'`;
    }

    public async shutdown() {
        await this.client.$disconnect();
    }

    public Facet<D extends TDelegate<R>, S extends TSubset, R, RT = R>(...args: [D, S, Transform<R, RT>?]) {
        return new Facet(this.client, ...args);
    }

    /*----------------------------------
    - OPERATIONS: PARSING
    ----------------------------------*/
    public SQL<TRowData extends {} | number | string>(strings: TemplateStringsArray, ...data: any[]) {
        const string = this.string(strings, ...data);

        const query = () =>
            this.client.$queryRawUnsafe(string).then((resultatRequetes) => normalizeSqlResult(resultatRequetes)) as Promise<
                TRowData[]
            >;

        query.all = query;
        query.value = <TValue extends any = number>() =>
            query().then((resultatRequetes: any) => {
                const resultat = resultatRequetes[0];

                if (!resultat) return null;

                return Object.values(resultat)[0] as TValue;
            });

        query.first = () =>
            query().then((resultatRequetes: any) => {
                return resultatRequetes[0] || null;
            });

        query.firstOrFail = (message: string) =>
            query().then((resultatRequetes: any) => {
                if (resultatRequetes.length === 0) throw new NotFound(message);

                return resultatRequetes[0];
            });

        query.string = string;

        return query;
    }

    public esc(data: any, forStorage: boolean = false) {
        // JSON object
        // TODO: do it via datatypes.ts
        if (typeof data === 'object' && data !== null) {
            // Object: stringify in JSON
            if (data.constructor.name === 'Object') data = safeStringify(data);
            // Array: if for storage, reparate items with a comma
            else if (forStorage && Array.isArray(data)) {
                data = data.join(',');
            }
        }

        return mysql.escape(data);
    }

    public string = (strings: TemplateStringsArray, ...data: any[]) => {
        const iMax = data.length - 1;

        if (typeof data === 'function')
            throw new Error(`A function has been passed into the sql string template: ` + data);

        return strings
            .map((stringBefore, i) => {
                if (i <= iMax) {
                    let value = data[i];
                    stringBefore = stringBefore.trim();
                    const prefix = stringBefore[stringBefore.length - 1];

                    // Null
                    if (value === undefined || value === null) {
                        value = 'NULL';

                        // Replace ""= NULL" by "IS NULL"
                        if (prefix === '=') stringBefore = stringBefore.substring(0, stringBefore.length - 1) + 'IS ';

                        // Prefix = special parse
                    } else if (prefix === ':' || prefix === '&') {
                        // Remove the prefix
                        stringBefore = stringBefore.substring(0, stringBefore.length - 1);

                        // Object: `WHERE :${filters}` => `SET requestId = "" AND col = 3`
                        if (typeof value === 'object') {
                            const keyword = prefix === '&' ? ' AND ' : ', ';

                            value = Object.keys(value).length === 0 ? '1' : this.equalities(value).join(keyword);

                            // String: `SET :${column} = ${data}` => `SET balance = 10`
                        } else {
                        }

                        // SQL query
                    } else if (typeof value === 'function' && value.string !== undefined) value = ' ' + value.string;
                    // Escape value
                    else {
                        const lastKeyword = stringBefore.trim().split(' ').pop();

                        // Escape table name
                        if (lastKeyword === 'FROM') value = '`' + value + '`';
                        else value = mysql.escape(value);

                        value = ' ' + value;
                    }
                    stringBefore += value;
                }

                return stringBefore;
            })
            .join(' ')
            .trim();
    };

    public equalities = (data: TObjetDonnees, forStorage: boolean = false) => {
        return Object.keys(data).map((k) => '' + k + ' = ' + this.esc(data[k], forStorage));
    };

    private traceQuery(event: TPrismaQueryEvent) {
        const store = context.getStore() as ChannelInfos | undefined;
        if (!store || store.channelType !== 'request' || !store.channelId) return;

        const operation = store.prismaOperations?.[store.prismaOperations.length - 1];

        this.app.container.Trace.recordSqlQuery(store.channelId, {
            callerCallId: store.traceCallId,
            callerFetcherId: store.traceCallFetcherId,
            callerLabel: store.traceCallLabel,
            callerMethod: store.method,
            callerOrigin: store.traceCallOrigin || 'request',
            callerPath: store.path,
            durationMs: event.duration,
            finishedAt: event.timestamp.toISOString(),
            kind: operation?.kind || 'orm',
            model: operation?.model,
            operation: operation?.operation || 'query',
            paramsJson: parseQueryParams(event.params),
            paramsText: event.params,
            query: event.query,
            target: event.target,
        });
    }
}
