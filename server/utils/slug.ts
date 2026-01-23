/*----------------------------------
- DEPENDANCES
----------------------------------*/

// Npm
import escapeStringRegexp from 'escape-regexp';
import slugify from 'slugify';
import { removeStopwords, eng } from 'stopword';

// Core
import type SQL from "@server/services/database";

/*----------------------------------
- TYPES
----------------------------------*/

/*----------------------------------
- SERVICE
----------------------------------*/
export class Slug {

    public async generate( label: string );
    public async generate( label: string, SQL: SQL, table: string, column: string );
    public async generate( label: string, SQL?: SQL, table?: string, column?: string ) {

        // Generate slug
        let slug = slugify(label, {
            replacement: '-',  // replace spaces with replacement character, defaults to `-`
            remove: /[^a-z\s]/ig, // remove characters that match regex, defaults to `undefined`
            lower: true,      // convert to lower case, defaults to `false`
            strict: true,     // strip special characters except replacement, defaults to `false`
            locale: 'vi',       // language code of the locale to use
            trim: true         // trim leading and trailing replacement chars, defaults to `true`
        });

        slug = removeStopwords( slug.split('-'), eng).join('-');

        // Check if already existing
        if (SQL !== undefined) {
            slug = await this.Correct(slug, SQL, table, column);
        }

        return slug;
    }

    public async Correct( 
        slug: string, 
        SQL: SQL, 
        table: string, 
        column: string 
    ) {
        
        const escapedSlug = escapeStringRegexp(slug);

        const duplicates = await SQL.selectVal<number>(`
            SELECT 
                IF( ${column} LIKE ${SQL.esc(slug)},
                    1,
                    CAST(SUBSTRING_INDEX(slug, '-', -1) AS UNSIGNED)
                ) AS duplicates
            FROM ${table} 
            WHERE 
                ${column} LIKE ${SQL.esc(slug)}
                OR
                ${column} REGEXP '^${escapedSlug}-[0-9]+$'
            ORDER BY duplicates DESC
            LIMIT 1
        `);

        if (duplicates && duplicates > 0)
            slug += `-${duplicates + 1}`;

        return slug;

    }

}

export default new Slug;