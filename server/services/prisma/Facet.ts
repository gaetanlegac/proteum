import type { PrismaClient } from '@models/types';

export type TDelegate<R = unknown> = {
    findMany(args?: Record<string, unknown>): Promise<R[]>;
    findFirst(args?: Record<string, unknown>): Promise<R | null>;
};

export type TWithStats = { $table: string; $key: string } & Record<string, string>;

export type TSubset = (...args: any[]) => Record<string, unknown> & { withStats?: TWithStats };

export type Transform<S extends TSubset, R, RT> = (row: R) => RT;

export default class Facet<
    D extends TDelegate<R>,
    S extends TSubset,
    R = unknown,
    RT = R,
> {
    constructor(
        private readonly prisma: PrismaClient,
        private readonly delegate: D,
        private readonly subset: S,
        private readonly transform?: Transform<S, R, RT>,
    ) {}

    public async findMany(...args: Parameters<S>): Promise<RT[]> {
        const { withStats, ...subset } = this.subset(...args);

        const results = await this.delegate.findMany(subset);
        if (results.length === 0) return [];

        const stats = withStats ? await this.fetchStats(withStats, results) : [];

        return results.map((row) => this.transformResult(row, stats, withStats));
    }

    public async findFirst(...args: Parameters<S>): Promise<RT | null> {
        const { withStats, ...subset } = this.subset(...args);

        const result = await this.delegate.findFirst(subset);
        if (!result) return null;

        const stats = withStats ? await this.fetchStats(withStats, [result]) : [];

        return this.transformResult(result, stats, withStats);
    }

    private async fetchStats(
        { $table, $key, ...withStats }: TWithStats,
        results: R[],
    ): Promise<Record<string, unknown>[]> {
        const select = Object.entries(withStats).map(
            ([key, sql]) =>
                `(COALESCE((
                ${sql}
            ), 0)) as ${key}`,
        );

        const statRows = (await this.prisma.$queryRawUnsafe(`
            SELECT ${$key}, ${select.join(', ')} 
            FROM ${$table} 
            WHERE ${$key} IN (
                ${(results as Array<Record<string, unknown>>).map((row) => "'" + row[$key] + "'").join(',')}
            )
        `)) as Record<string, unknown>[];

        for (const stat of statRows) {
            for (const key in stat) {
                if (key === $key) continue;
                stat[key] = stat[key] ? parseInt(String(stat[key]), 10) : 0;
            }
        }

        return statRows;
    }

    private transformResult(result: R, stats: Record<string, unknown>[], withStats?: TWithStats): RT {
        const resultRecord = result as Record<string, unknown>;
        const resultStats = withStats
            ? stats.find((stat) => stat[withStats.$key] === resultRecord[withStats.$key]) || {}
            : {};

        if (!this.transform) return { ...resultRecord, ...resultStats } as RT;

        const transformed = this.transform(result);

        return { ...(transformed as object), ...resultStats } as RT;
    }
}
