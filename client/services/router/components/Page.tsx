/*----------------------------------
- DEPENDANCES
----------------------------------*/
// Npm
import React from 'react';

// Core
import useContext from '@/client/context';
import type { TFrontRenderer } from '@common/router/response/page';

// Specific
import type Page from '../response/page';

/*----------------------------------
- PAGE STATE
----------------------------------*/

export default ({ page }: { page: Page }) => {
    /*----------------------------------
    - CONTEXT
    ----------------------------------*/
    const context = useContext();

    // Bind data
    const [apiData, setApiData] = React.useState<{ [k: string]: any } | null>(page.data || {});
    page.setAllData = setApiData;
    const fullData = { ...context.data, ...apiData };

    // Bind navigation the same way: the page instance holds the state, the setter re-renders
    //  A same-chunk navigation keeps this component, so the new page takes over both setters
    const [, setNavigation] = React.useState(page.navigation);
    page.setNavigation = setNavigation;
    const { navigation } = page;

    // Temporary fix: context.page may not be updated at this stage
    //  Seems to be the case when we change page, but still same page component with different data
    // TODO: ensure these updated are made every tume we change page / context
    context.page = page;
    context.data = fullData;
    context.context = context;

    // Page component has not changed, but data were updated (ex: url parameters change)
    //  A deferred page gets its data from the navigation sequencer instead: it keeps the previous data
    //  on screen while stale, and merges a reload into what api.set wrote
    React.useEffect(() => {
        if (!page.isDeferred()) setApiData(page.data);
    }, [page.data]);

    // Only a page declaring navigation: 'deferred' receives the prop: blocking pages may use the key for data
    const rendererProps = {
        ...context,
        ...fullData,
        ...(page.route.options.navigation === 'deferred' ? { navigation } : {}),
    } as Parameters<TFrontRenderer>[0];
    // A deferred renderer reads the same props, plus `navigation`
    const Renderer = page.renderer as TFrontRenderer | undefined;

    /*----------------------------------
    - RENDER
    ----------------------------------*/
    //  Make request parameters and api data accessible from the page component
    return Renderer ? <Renderer {...rendererProps} /> : <>Renderer missing</>;
};
