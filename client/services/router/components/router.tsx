/*----------------------------------
- DEPENDANCES
----------------------------------*/
// Npm
import React from 'react';

// Core
import useContext from '@/client/context';

// Specific
import type ClientRouter from '..';
import PageComponent from './Page';
import ClientRequest from '../request';
import { history, location, Update } from '../request/history';
//import initTooltips from '@client/components/Donnees/Tooltip';
import type Page from '../response/page';

/*----------------------------------
- TYPES
----------------------------------*/

export type PropsPage<TParams extends { [cle: string]: unknown }> = TParams & {
    data: {[cle: string]: unknown}
}

export type TProps = {
    service?: ClientRouter,
    loaderComponent?: React.ComponentType<{ isLoading: boolean }>,
}

/*----------------------------------
- PAGE STATE
----------------------------------*/

const LogPrefix = `[router][component]`

const PageLoading = ({ clientRouter, loaderComponent: LoaderComponent }: { 
    clientRouter?: ClientRouter,
    loaderComponent?: React.ComponentType<{ isLoading: boolean }>,
}) => {

    const [isLoading, setLoading] = React.useState(false);

    if (clientRouter)
        clientRouter.setLoading = setLoading;

    return LoaderComponent 
        ? <LoaderComponent isLoading={isLoading} /> 
        : (
            <div id="loading" class={isLoading ? 'display' : ''}>
                <i src="spin" />
            </div>
        )
}

const scrollToElement = (selector: string) => document.querySelector( selector )
    ?.scrollIntoView({
        behavior: "smooth", 
        block: "start", 
        inline: "nearest"
    })

/*----------------------------------
- COMPONENT
----------------------------------*/
export default ({ service: clientRouter, loaderComponent }: TProps) => {

    /*----------------------------------
    - INIT
    ----------------------------------*/

    const context = useContext();

    const [currentPage, setCurrentPage] = React.useState<undefined | Page>(context.page);

    // Bind context object to client router
    if (clientRouter !== undefined) {
        clientRouter.context = context;
        clientRouter.navigate = changePage;
    }
    
    /*----------------------------------
    - ACTIONS
    ----------------------------------*/
    const resolvePage = async (request: ClientRequest, data: {} = {}) => {

        if (!clientRouter) return;

        const currentRequest = context.request;
        context.request = request;

        // WARNING: Don"t try to play with pages here, since the object will not be updated
        //  If needed to play with pages, do it in the setPages callback below
        // Unchanged path
        if (
            request.path === currentRequest.path 
            && 
            request.hash !== currentRequest.hash
            && 
            request.hash !== undefined
        ) {
            scrollToElement(request.hash);
            return;
        }
        
        // Set loading state
        clientRouter.runHook('page.change', request);
        window.scrollTo({
            top: 0,
            behavior: 'smooth'
        });
        clientRouter.setLoading(true);
        const newpage = context.page = await clientRouter.resolve(request);

        // Unable to load (no connection, server error, ....)
        if (newpage === null) {
            return;
        }

        return await changePage(newpage, data, request);
    }

    async function changePage(newpage: Page, data?: {}, request?: ClientRequest) {

        // Fetch API data to hydrate the page
        try {
            await newpage.preRender();
        } catch (error) {
            console.error(LogPrefix, "Unable to fetch data:", error);
            clientRouter?.setLoading(false);
            return;
        }

        // Add additional data
        if (data)
            newpage.data = { ...newpage.data, ...data };

        // Add page container
        setCurrentPage( page => {

            // WARN: Don't cancel navigation if same page as before, as we already instanciated the new page and bound the context with it
            //  Otherwise it would cause reference issues (ex: page.setAllData makes ref to the new context)

            // If if the layout changed
            const curLayout = currentPage?.layout;
            const newLayout = newpage?.layout;
            if (newLayout && curLayout && newLayout.path !== curLayout.path) {

                // TEMPORARY FIX: reload everything when we change layout
                //  Because layout can have a different CSS theme
                //  But when we call setLayout, the style of the previous layout are still oaded and applied
                //  Find a way to unload the  previous layout / page resources before to load the new one
                console.log(LogPrefix, `Changing layout. Before:`, curLayout, 'New layout:', newLayout);
                /*window.location.replace( request ? request.url : window.location.href );
                return page; // Don't spread since it's an instance*/

                context.app.setLayout(newLayout);
            }

            return newpage;
        });
    }

    const restoreScroll = (currentPage?: Page) => currentPage?.scrollToId 
        && scrollToElement( currentPage.scrollToId.substring(1) )

    // First render
    React.useEffect(() => {

        // Resolve page if it wasn't done via SSR
        if (context.page === undefined)
            resolvePage(context.request);

        // Foreach URL change (Ex: bowser' back buttton)
        return history?.listen(async (locationUpdate) => {

            // Load the concerned route
            const request = new ClientRequest(locationUpdate.location, context.Router);
            await resolvePage(request);
        })
    }, []);

    // On every page change
    React.useEffect(() => {

        if (!clientRouter) return;

        // Page loaded
        clientRouter.setLoading(false);

        // Reset scroll
        window.scrollTo(0, 0);
        // Should be called AFTER rendering the page (so after the state change)
        currentPage?.updateClient();
        // Scroll to the selected content via url hash
        restoreScroll(currentPage);

        // Hooks
        clientRouter.runHook('page.changed', currentPage)
        
    }, [currentPage]);

    /*----------------------------------
    - RENDER
    ----------------------------------*/
    // Render the page component
    return <>
        {currentPage && (
            <PageComponent page={currentPage} 
                /* Create a new instance of the Page component every time the page change 
                Otherwise the page will memorise the data of the previous page */
                key={currentPage.chunkId === undefined ? undefined : 'page_' + currentPage.chunkId} 
            />
        )}

        <PageLoading clientRouter={clientRouter} loaderComponent={loaderComponent} />
    </>
}