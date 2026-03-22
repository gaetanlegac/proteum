/*----------------------------------
- DEPENDANCES
----------------------------------*/

// Npm
import type { ComponentChild } from 'preact';

// Core
import type { TRouteOptions } from '.';
import type { TDataProvider, TPageRenderContext } from './response/page';

// App
import internalLayout from '@client/pages/_layout';
import generatedLayouts, { layoutOrder } from '@generated/client/layouts';

/*----------------------------------
- CONST
----------------------------------*/

export const layoutsList: ImportedLayouts = generatedLayouts;

/*----------------------------------
- TYPES
----------------------------------*/
export type LayoutProps = {
    [key: string]: unknown;
    context: TPageRenderContext;
    menu: ComponentChild;
    children: ComponentChild;
} & TPageRenderContext;

type LayoutComponent = (attributes: LayoutProps) => ComponentChild;

export type Layout = { path: string; Component: LayoutComponent; data?: TDataProvider };

export type ImportedLayouts = { [chunkId: string]: { default: Layout['Component']; data?: TDataProvider } };

/*----------------------------------
- UTILS
----------------------------------*/
// TODO: getLayot only on server side, and pass the layout chunk id
export const getLayout = (routePath: string, routeOptions?: Partial<TRouteOptions>): Layout | undefined => {
    if (routeOptions === undefined) return undefined;
    // W don't want a layout on this page
    if (routeOptions.layout === false) return undefined;

    // options.id has been injected via the babel plugon
    const chunkId = routeOptions.id;
    if (chunkId === undefined) {
        console.error('Route informations where ID cas not injected:', routeOptions);
        throw new Error(`ID has not injected for the following page route: ${routePath}`);
    }

    // Layout via name
    if (routeOptions.layout !== undefined) {
        const layoutModule = layoutsList[routeOptions.layout];
        const { default: LayoutComponent, data } = layoutModule || {};
        if (LayoutComponent === undefined)
            throw new Error(
                `No layout found with ID: ${routeOptions.layout}. registered layouts: ${Object.keys(layoutsList)}`,
            );

        return { path: routeOptions.layout, Component: layoutModule.default, data };
    }

    // Automatic layout via the nearest _layout folder
    for (const layoutPath of layoutOrder as string[])
        if (
            // The layout is nammed '' when it's at the root (@/client/pages/_layout)
            layoutPath === '' || // Root layout
            // Exact match
            chunkId === layoutPath ||
            // Parent
            chunkId.startsWith(layoutPath + '_')
        )
            return { path: layoutPath, Component: layoutsList[layoutPath].default, data: layoutsList[layoutPath].data };

    // Internal layout
    return { path: '/', Component: internalLayout };
};
