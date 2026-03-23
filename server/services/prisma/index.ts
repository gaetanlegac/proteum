/*----------------------------------
- DEPENDANCES
----------------------------------*/

// Npm
import dotenv from 'dotenv';
import { PrismaClient } from '@generated/server/models';
import mysql from 'mysql2/promise';
const safeStringify = require('fast-safe-stringify'); // remplace les références circulairs par un [Circular]

// Core
import type { Application } from '@server/app/index';
import Service, { TServiceArgs } from '@server/app/service';

// Specific
import Facet, { TDelegate, TSubset, Transform } from './Facet';
import { createMariaDbAdapter } from './mariadb';
import { NotFound } from '@common/errors';

/*----------------------------------
- TYPES
----------------------------------*/

export type SqlQuery = ReturnType<ModelsManager['SQL']>;

/*----------------------------------
- SERVICE CONFIG
----------------------------------*/

export type Config = { debug?: boolean };

export type Hooks = {};

export type Services = {};

// Fix: Do not know how to serialize a BigInt
BigInt.prototype.toJSON = function () {
    const int = Number.parseInt(this.toString());
    return int ?? this.toString();
};

/*----------------------------------
- CLASSE
----------------------------------*/

export default class ModelsManager extends Service<Config, Hooks, Application, Application> {
    public client: PrismaClient;

    public constructor(...args: TServiceArgs<ModelsManager>) {
        super(...args);

        dotenv.config();

        const databaseUrl = process.env.DATABASE_URL;
        if (!databaseUrl)
            throw new Error(
                'DATABASE_URL is required before starting the Models service. Prisma 7 no longer auto-loads runtime env files.',
            );

        this.client = new PrismaClient({
            adapter: createMariaDbAdapter(databaseUrl),
        });
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

        const query = () => {
            return this.client.$queryRawUnsafe(string) as Promise<TRowData[]>;
        };

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
}
