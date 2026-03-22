/*----------------------------------
- DEPENDANCES
----------------------------------*/

// Npm
import escapeStringRegexp from 'escape-regexp';
import slugify from 'slugify';
import { removeStopwords, eng } from 'stopword';

/*----------------------------------
- TYPES
----------------------------------*/

type TSlugSqlClient = {
    esc?: (value: unknown) => string;
    selectVal?: <TValue = number>(query: string) => Promise<TValue | null>;
};

/*----------------------------------
- SERVICE
----------------------------------*/
export class Slug {
    public async generate(label: string): Promise<string>;
    public async generate(label: string, sql: TSlugSqlClient, table: string, column: string): Promise<string>;
    public async generate(
        label: string,
        sql?: TSlugSqlClient,
        table?: string,
        column?: string,
    ): Promise<string> {
        let slug = slugify(label, {
            replacement: '-',
            remove: /[^a-z\s]/gi,
            lower: true,
            strict: true,
            locale: 'vi',
            trim: true,
        });

        slug = removeStopwords(slug.split('-'), eng).join('-');

        if (sql && table && column) slug = await this.Correct(slug, sql, table, column);

        return slug;
    }

    public async Correct(slug: string, sql: TSlugSqlClient, table: string, column: string): Promise<string> {
        if (!sql.esc || !sql.selectVal) return slug;

        const escapedSlug = escapeStringRegexp(slug);

        const duplicates = await sql.selectVal<number>(`
            SELECT 
                IF( ${column} LIKE ${sql.esc(slug)},
                    1,
                    CAST(SUBSTRING_INDEX(slug, '-', -1) AS UNSIGNED)
                ) AS duplicates
            FROM ${table} 
            WHERE 
                ${column} LIKE ${sql.esc(slug)}
                OR
                ${column} REGEXP '^${escapedSlug}-[0-9]+$'
            ORDER BY duplicates DESC
            LIMIT 1
        `);

        if (duplicates && duplicates > 0) slug += `-${duplicates + 1}`;

        return slug;
    }
}

export default new Slug();
