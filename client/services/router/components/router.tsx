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
import PageLoading from './PageLoading';
import ClientRequest from '../request';
import { history, location, Update } from '../request/history';
//import initTooltips from '@client/components/Donnees/Tooltip';
import type Page from '../response/page';
import { createNavigationSequencer, type TNavigationSequencer } from '../navigation';

/*----------------------------------
- TYPES
----------------------------------*/

export type PropsPage<TParams extends { [cle: string]: unknown }> = TParams & { data: { [cle: string]: unknown } };

export type TProps = { service?: ClientRouter; loaderComponent?: React.ComponentType<{ isLoading: boolean }> };

/*----------------------------------
- HELPERS
----------------------------------*/

const LogPrefix = `[router][component]`;
const withProfiler = <T,>(callback: (runtime: (typeof import('@client/dev/profiler/runtime'))['profilerRuntime']) => T) => {
    if (!__DEV__) return undefined as T | undefined;
    const profilerModule = require('@client/dev/profiler/runtime') as typeof import('@client/dev/profiler/runtime');
    return callback(profilerModule.profilerRuntime);
};

// The hash arrives percent-encoded (`#caf%C3%A9`): the id is matched decoded, like the browser's own fragment scroll
const readHashId = (hash: string) => {
    const id = hash.startsWith('#') ? hash.slice(1) : hash;
    try {
        return decodeURIComponent(id);
    } catch (error) {
        // A malformed escape cannot name a decoded id: look it up as written
        if (error instanceof URIError) return id;
        throw error;
    }
};

// Exported for the router tests. A hash names an element id, so look the id up: as a selector, `#prices` minus
//  its `#` matches a <prices> tag, and an id such as `2026-prices` throws.
export const scrollToHash = (hash: string) => {
    const id = readHashId(hash);
    if (id) document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start', inline: 'nearest' });
};

/*----------------------------------
- NAVIGATION
----------------------------------*/

type TRouterView = {
    setCurrentPage: React.Dispatch<React.SetStateAction<Page | undefined>>;
    setReadyCount: React.Dispatch<React.SetStateAction<number>>;
};

type TRouterNavigation = { sequencer: TNavigationSequencer<ClientRequest, Page>; view: TRouterView };

const navigations = new WeakMap<ClientRouter, TRouterNavigation>();

// Exported for the router tests
export const createRouterNavigation = (
    clientRouter: ClientRouter,
    context: ReturnType<typeof useContext>,
    view: TRouterView,
    initialPage: Page | undefined,
): TRouterNavigation => {
    const navigation: TRouterNavigation = { view, sequencer: undefined! };

    navigation.sequencer = createNavigationSequencer<ClientRequest, Page>(
        {
            resolve: (request, isCurrent) => clientRouter.resolve(request, isCurrent),
            defers: (page) => page.isDeferred(),
            prepare: (page) => {
                page.prepareFetchers();
            },
            // Fetch API data to hydrate the page
            fetch: (page, prepared) => page.preRender(undefined, prepared ? page.fetchers : undefined),
            commit: (newpage) => {
                // The context names the page on screen: set at the swap, never at resolution, so a navigation
                //  that never commits (superseded, failed) leaves api.set and api.reload on the page still shown
                context.page = newpage as typeof context.page;

                // Add page container
                navigation.view.setCurrentPage((page) => {
                    // WARN: Don't cancel navigation if same page as before, as we already instanciated the new page
                    //  and bound the context with it. Otherwise it would cause reference issues
                    //  (ex: page.setAllData makes ref to the new context)

                    // If if the layout changed
                    const curLayout = page?.layout;
                    const newLayout = newpage?.layout;
                    if (newLayout && curLayout && newLayout.path !== curLayout.path) {
                        // TEMPORARY FIX: reload everything when we change layout
                        //  Because layout can have a different CSS theme
                        //  But when we call setLayout, the style of the previous layout are still oaded and applied
                        //  Find a way to unload the  previous layout / page resources before to load the new one
                        console.log(LogPrefix, `Changing layout. Before:`, curLayout, 'New layout:', newLayout);
                        const app = context.app as { setLayout?: (layout: NonNullable<typeof newLayout>) => void };
                        app.setLayout?.(newLayout);
                    }

                    return newpage;
                });
            },
            // Data and navigation state change in one batch, so no render sees ready without the data
            render: (page, data) => {
                if (data === 'replace') page.setAllData(() => page.data);
                else if (data === 'merge') page.setAllData((current) => ({ ...current, ...page.data }));
                page.setNavigation(page.navigation);
            },
            ready: () => navigation.view.setReadyCount((count: number) => count + 1),
            setLoading: (loading) => clientRouter.setLoading(loading),
            fail: (step, error, sessionId) => {
                const message = step === 'route' ? 'Unable to load the page:' : 'Unable to fetch data:';
                console.error(LogPrefix, message, error);
                // A chunk that fails to load means a new version: the app error handler tells the user
                if (step === 'route') clientRouter.app.handleError(error);
                if (step === 'retry') return;
                withProfiler((runtime) =>
                    runtime.failNavigation(error instanceof Error ? error.message : String(error), sessionId),
                );
            },
            startRender: (sessionId) => withProfiler((runtime) => runtime.startRenderStep(sessionId)),
        },
        initialPage,
    );

    return navigation;
};

/*----------------------------------
- COMPONENT
----------------------------------*/
export default ({ service: clientRouter, loaderComponent }: TProps) => {
    /*----------------------------------
    - CONTEXT
    ----------------------------------*/

    const context = useContext();
    const [currentPage, setCurrentPage] = React.useState<undefined | Page>(context.page as Page | undefined);
    // Bumped when a deferred page settles ready for the first time, so page.ready runs after that render
    const [readyCount, setReadyCount] = React.useState(0);
    const readyPage = React.useRef<Page>();

    // The sequencer outlives this component, which remounts when the layout changes: ports reach the mounted one
    const view: TRouterView = { setCurrentPage, setReadyCount };
    let navigation = clientRouter && navigations.get(clientRouter);
    if (navigation) navigation.view = view;
    else if (clientRouter) {
        navigation = createRouterNavigation(clientRouter, context, view, currentPage);
        navigations.set(clientRouter, navigation);
    }

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

        const currentRequest = context.request as ClientRequest;
        context.request = request as typeof context.request;

        // WARNING: Don"t try to play with pages here, since the object will not be updated
        //  If needed to play with pages, do it in the setPages callback below
        // Unchanged path
        if (
            request.path === currentRequest.path &&
            request.hash !== currentRequest.hash &&
            request.hash !== undefined
        ) {
            scrollToHash(request.hash);
            return;
        }

        // Set loading state
        const sessionId = withProfiler((runtime) =>
            runtime.startNavigationSession({
                path: request.path,
                url: request.url,
            }),
        );
        clientRouter.runHook('page.change', request);
        window.scrollTo({ top: 0, behavior: 'smooth' });

        // Loader, route, then data and swap in the order of the page navigation mode
        return await navigation?.sequencer.navigate(request, data, sessionId);
    };

    function changePage(newpage: Page, data?: {}) {
        return navigation?.sequencer.show(newpage, data);
    }

    /*----------------------------------
    - HOOKS
    ----------------------------------*/

    const restoreScroll = (currentPage?: Page) => currentPage?.scrollToId && scrollToHash(currentPage.scrollToId);

    const finishNavigation = (currentPage?: Page) => {
        const routeLabel =
            currentPage && 'path' in currentPage.route && currentPage.route.path
                ? currentPage.route.path
                : currentPage && 'code' in currentPage.route
                  ? String(currentPage.route.code)
                  : undefined;
        withProfiler((runtime) =>
            runtime.finishNavigation({
                chunkId: currentPage?.chunkId,
                routeLabel,
                title: currentPage?.title,
            }),
        );
    };

    // page.ready: once per page, after the render that shows its data
    const markReady = (page: Page | undefined, afterData: boolean) => {
        if (!clientRouter || !page || readyPage.current === page || page.navigation.status !== 'ready') return;
        readyPage.current = page;

        if (afterData) {
            // Title, body classes and hash target come from the render with data
            page.updateClient();
            restoreScroll(page);
            finishNavigation(page);
        }

        clientRouter.runHook('page.ready', (page.context.request || context.request) as ClientRequest);
    };

    // First render
    React.useEffect(() => {
        // Resolve page if it wasn't done via SSR
        if (context.page === undefined) resolvePage(context.request as ClientRequest);

        // Foreach URL change (Ex: bowser' back buttton)
        return history?.listen(async (locationUpdate) => {
            // Load the concerned route
            const request = new ClientRequest(locationUpdate.location, context.Router);
            await resolvePage(request);
        });
    }, []);

    // A deferred page keeps the loader until its data settles. Read here, at render, for the effect below: data
    //  landing between this render and that effect (one frame) would read as ready there, fire page.ready before
    //  the data render, and leave the refresh after it (title, hash scroll, profiler) unrun.
    const pending = currentPage !== undefined && currentPage.navigation.status !== 'ready';

    // On every page change
    React.useEffect(() => {
        if (!clientRouter) return;

        // Page loaded
        if (!pending) clientRouter.setLoading(false);

        // Reset scroll
        window.scrollTo(0, 0);
        // Should be called AFTER rendering the page (so after the state change)
        currentPage?.updateClient();
        // Scroll to the selected content via url hash
        restoreScroll(currentPage);
        if (!pending) finishNavigation(currentPage);

        // Hooks
        clientRouter.runHook('page.changed', (currentPage?.context.request || context.request) as ClientRequest);
        if (!pending) markReady(currentPage, false);
    }, [currentPage]);

    // A deferred page settled ready
    React.useEffect(() => {
        if (readyCount > 0) markReady(currentPage, true);
    }, [readyCount]);

    /*----------------------------------
    - RENDER
    ----------------------------------*/
    // Render the page component
    return (
        <>
            {currentPage && (
                    <PageComponent
                    page={currentPage as Parameters<typeof PageComponent>[0]['page']}
                    /* Create a new instance of the Page component every time the page change
                    Otherwise the page will memorise the data of the previous page */
                    key={currentPage.chunkId === undefined ? undefined : 'page_' + currentPage.chunkId}
                />
            )}

            <PageLoading clientRouter={clientRouter} loaderComponent={loaderComponent} />
        </>
    );
};
