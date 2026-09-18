/*----------------------------------
- CSS MINIMIZER
----------------------------------*/

/**
 * Minifies the emitted stylesheets with the `lightningcss` npm package instead of
 * rspack's `LightningCssMinimizerRspackPlugin`.
 *
 * The rspack plugin runs the LightningCSS copy bundled in its Rust binding, and that
 * copy prints a declaration followed by a nested at-rule without the semicolon between
 * them when the nesting is two levels deep (`.a{@media (...){color:#fff;@supports (...){...}}}`
 * comes out as `color:#fff@supports (...)`), which invalidates the whole rule. Tailwind v4
 * emits exactly that shape for every variant with an opacity modifier, so a production
 * build silently lost hover, responsive and dark-mode colours while dev looked right.
 * Reproduced on @rspack/core 1.7.9 through 2.2.6 whenever the browser targets keep CSS
 * nesting; `lightningcss` 1.33 prints it correctly, so the minifier reads that package.
 */

/*----------------------------------
- DEPENDENCIES
----------------------------------*/

import browserslist from 'browserslist';
import { browserslistToTargets, transform } from 'lightningcss';
import type { Compiler } from '@rspack/core';

/*----------------------------------
- TYPES
----------------------------------*/

export type TCssMinimizerOptions = {
    /** Browserslist queries; omitted means LightningCSS defaults (no lowering). */
    targets?: string | readonly string[];
};

/*----------------------------------
- PLUGIN
----------------------------------*/

const PLUGIN_NAME = 'ProteumCssMinimizer';

export const minifyCss = (filename: string, code: string, options: TCssMinimizerOptions = {}): string => {
    const targets = options.targets ? browserslistToTargets(browserslist(options.targets)) : undefined;
    const result = transform({
        filename,
        code: Buffer.from(code),
        minify: true,
        ...(targets ? { targets } : {}),
    });

    return result.code.toString();
};

export default class CssMinimizerPlugin {
    public constructor(private readonly options: TCssMinimizerOptions = {}) {}

    public apply(compiler: Compiler) {
        const { Compilation, sources } = compiler.webpack;

        compiler.hooks.thisCompilation.tap(PLUGIN_NAME, (compilation) => {
            compilation.hooks.processAssets.tap(
                { name: PLUGIN_NAME, stage: Compilation.PROCESS_ASSETS_STAGE_OPTIMIZE_SIZE },
                (assets) => {
                    for (const [name, source] of Object.entries(assets)) {
                        if (!name.endsWith('.css')) continue;

                        const minified = minifyCss(name, source.source().toString(), this.options);
                        compilation.updateAsset(name, new sources.RawSource(minified), { minimized: true });
                    }
                },
            );
        });
    }
}
