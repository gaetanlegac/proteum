/*----------------------------------
- DEPENDANCES
----------------------------------*/
// Npm
import React from 'react';

// Core
import useContext from '@/client/context';

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
    const [apiData, setApiData] = React.useState<{[k: string]: any} | null>( page.data || {});
    page.setAllData = setApiData;
    const fullData = {
        ...context.data,
        ...apiData
    }

    // Temporary fix: context.page may not be updated at this stage
    //  Seems to be the case when we change page, but still same page component with different data
    // TODO: ensure these updated are made every tume we change page / context
    context.page = page;
    context.data = fullData;
    context.context = context;

    // Page component has not changed, but data were updated (ex: url parameters change)
    React.useEffect(() => {

        setApiData(page.data);

    }, [page.data]);

    /*----------------------------------
    - RENDER
    ----------------------------------*/
    //  Make request parameters and api data accessible from the page component
    return page.renderer ? (

        <page.renderer {...context} />
        
    ) : <>Renderer missing</>
}