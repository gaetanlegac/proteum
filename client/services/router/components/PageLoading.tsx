/*----------------------------------
- PAGE LOADING INDICATOR
----------------------------------*/

// Npm
import React from 'react';

// Specific
import type ClientRouter from '..';

/*----------------------------------
- TYPES
----------------------------------*/

export type TPageLoadingProps = {
    clientRouter?: ClientRouter;
    loaderComponent?: React.ComponentType<{ isLoading: boolean }>;
};

/*----------------------------------
- COMPONENT
----------------------------------*/

/**
 * Rendered by both the client router and its SSR variant. The server used to omit it,
 * so every hydration started with "Expected a DOM node of type div" in the console:
 * the loader must exist in the server HTML, idle, for the two trees to match.
 */
export default function PageLoading({ clientRouter, loaderComponent: LoaderComponent }: TPageLoadingProps) {
    const [isLoading, setLoading] = React.useState(false);

    if (clientRouter) clientRouter.setLoading = setLoading;

    return LoaderComponent ? (
        <LoaderComponent isLoading={isLoading} />
    ) : (
        <div id="loading" class={isLoading ? 'display' : ''}>
            <i class="spin" />
        </div>
    );
}
