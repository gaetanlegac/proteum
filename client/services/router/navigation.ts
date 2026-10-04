/*----------------------------------
- DEPENDANCES
----------------------------------*/

// Core
import {
    createPageNavigation,
    type TPageNavigation,
    type TPageNavigationState,
} from '@common/router/response/page';

/*----------------------------------
- TYPES
----------------------------------*/

export type TNavigationMode = 'blocking' | 'deferred';

// What the sequencer reads and writes on a page. ClientPage satisfies it.
export type TNavigationPage = {
    chunkId?: string;
    data: TObjetDonnees;
    navigation: TPageNavigation;
};

export type TNavigationPorts<TRequest, TPage extends TNavigationPage> = {
    // Loads the route chunk and builds the page without its data. Null when isCurrent() turned false during the load.
    resolve: (request: TRequest, isCurrent: () => boolean) => Promise<TPage | null>;
    // True when the page swaps in before its data
    defers: (page: TPage) => boolean;
    // Runs the data providers without fetching, so a throwing provider aborts before the swap
    prepare: (page: TPage) => void;
    // Fetches page.data. `prepared` reuses the fetchers built by prepare().
    fetch: (page: TPage, prepared: boolean) => Promise<unknown>;
    // Swaps the rendered page
    commit: (page: TPage) => void;
    // Re-renders a committed page with page.navigation, and with page.data when given:
    //  'replace' for the first data of a navigation, 'merge' for a retry (keeps values written with api.set)
    render: (page: TPage, data?: 'replace' | 'merge') => void;
    // A deferred navigation is ready for the first time
    ready: (page: TPage) => void;
    setLoading: (loading: boolean) => void;
    // Logs a failed step. 'retry' is a data step started by navigation.retry().
    fail: (step: 'route' | 'data' | 'retry', error: unknown, sessionId?: string) => void;
    // Profiler render step
    startRender: (sessionId?: string) => void;
};

export type TNavigationSequencer<TRequest, TPage extends TNavigationPage> = {
    // A client navigation, from the loader to the swap
    navigate: (request: TRequest, data?: TObjetDonnees, sessionId?: string) => Promise<void>;
    // Shows a page that is already resolved (error pages)
    show: (page: TPage, data?: TObjetDonnees, sessionId?: string) => Promise<void>;
    // Re-runs the data step of the current page when it defers
    retry: () => Promise<void>;
    current: () => TPage | undefined;
};

type TEntry<TPage> = { page: TPage; token: number; dataToken: number; ready: boolean };

/*----------------------------------
- HELPERS
----------------------------------*/

// A page defers only when the router mode is deferred, the page declares it, and it has a data loader
export const shouldDeferNavigation = (
    mode: TNavigationMode | undefined,
    route: { options: { navigation?: TNavigationMode }; data?: unknown },
) => mode === 'deferred' && route.options.navigation === 'deferred' && typeof route.data === 'function';

const toError = (error: unknown) => (error instanceof Error ? error : new Error(String(error)));

/*----------------------------------
- SEQUENCER
----------------------------------*/

/**
 * Orders the steps of a client navigation.
 * Blocking: loader, route, data, swap. Deferred: loader, route, providers, swap with a pending state, data.
 * Every navigation takes a new token and gives up after an await that returns to an older one;
 * a data step also gives up once its page left the screen or a newer data step started for it.
 */
export const createNavigationSequencer = <TRequest, TPage extends TNavigationPage>(
    ports: TNavigationPorts<TRequest, TPage>,
    initialPage?: TPage,
): TNavigationSequencer<TRequest, TPage> => {
    let token = 0;
    let current: TEntry<TPage> | undefined;

    const setNavigation = (entry: TEntry<TPage>, state: TPageNavigationState) => {
        entry.page.navigation = createPageNavigation(state, () => {
            if (current === entry) void retry();
        });
    };

    const runData = async (entry: TEntry<TPage>, retrying: boolean, data?: TObjetDonnees, sessionId?: string) => {
        const dataToken = ++entry.dataToken;
        const isCurrent = () => current === entry && entry.dataToken === dataToken;
        // The loader belongs to the latest navigation
        const releaseLoading = () => token === entry.token && ports.setLoading(false);

        try {
            await ports.fetch(entry.page, !retrying);
        } catch (error) {
            if (!isCurrent()) return;
            const { stale, reloading } = entry.page.navigation;
            setNavigation(entry, { status: 'error', stale, reloading, error: toError(error) });
            ports.render(entry.page);
            ports.fail(retrying ? 'retry' : 'data', error, sessionId);
            releaseLoading();
            return;
        }
        if (!isCurrent()) return;

        // Add additional data
        if (data) entry.page.data = { ...entry.page.data, ...data };
        setNavigation(entry, { status: 'ready' });
        // Merge only into data this navigation already showed (api.set values survive a reload). Until then the
        //  Page component may still hold the previous page's data (a same-chunk navigation keeps it), so the
        //  first data render replaces it, including a retry that recovers a failed first data step.
        ports.render(entry.page, entry.ready ? 'merge' : 'replace');
        releaseLoading();

        if (!entry.ready) {
            entry.ready = true;
            ports.ready(entry.page);
        }
    };

    const showPage = async (
        page: TPage,
        data: TObjetDonnees | undefined,
        sessionId: string | undefined,
        navigationToken: number,
    ) => {
        const isCurrent = () => token === navigationToken;

        // Blocking: the data, then the swap
        if (!ports.defers(page)) {
            try {
                await ports.fetch(page, false);
            } catch (error) {
                if (!isCurrent()) return;
                ports.fail('data', error, sessionId);
                ports.setLoading(false);
                return;
            }
            if (!isCurrent()) return;

            // Add additional data
            if (data) page.data = { ...page.data, ...data };
            ports.startRender(sessionId);
            current = { page, token: navigationToken, dataToken: 0, ready: true };
            ports.commit(page);
            return;
        }

        // Deferred: a throwing provider aborts like a blocking data failure
        try {
            ports.prepare(page);
        } catch (error) {
            if (!isCurrent()) return;
            ports.fail('data', error, sessionId);
            ports.setLoading(false);
            return;
        }
        // A provider can start a navigation itself (a redirect): the page is superseded before its swap
        if (!isCurrent()) return;

        // Same chunk keeps the rendered tree, so the previous data stays on screen while it has some
        const previous = current?.page.navigation;
        const stale =
            current !== undefined &&
            current.page.chunkId === page.chunkId &&
            (previous?.status === 'ready' || previous?.stale === true);
        const entry: TEntry<TPage> = { page, token: navigationToken, dataToken: 0, ready: false };
        setNavigation(entry, { status: 'pending', stale });
        ports.startRender(sessionId);
        current = entry;
        ports.commit(page);

        await runData(entry, false, data, sessionId);
    };

    const navigate = async (request: TRequest, data: TObjetDonnees = {}, sessionId?: string) => {
        const navigationToken = ++token;
        const isCurrent = () => token === navigationToken;

        ports.setLoading(true);

        let page: TPage | null;
        try {
            page = await ports.resolve(request, isCurrent);
        } catch (error) {
            // Chunk load failure
            if (!isCurrent()) return;
            ports.fail('route', error, sessionId);
            ports.setLoading(false);
            return;
        }

        // Unable to load, or superseded during the load
        if (page === null || !isCurrent()) return;

        await showPage(page, data, sessionId, navigationToken);
    };

    const retry = async () => {
        const entry = current;
        if (!entry || !ports.defers(entry.page)) return;

        const { navigation } = entry.page;
        setNavigation(entry, {
            status: 'pending',
            stale: navigation.status === 'ready' || navigation.stale,
            // A reload of data this navigation showed, not a first load that failed
            reloading: entry.ready,
        });
        ports.render(entry.page);

        await runData(entry, true);
    };

    // The SSR page is ready: bind its retry
    if (initialPage) {
        current = { page: initialPage, token, dataToken: 0, ready: true };
        setNavigation(current, { status: 'ready' });
    }

    return {
        navigate,
        show: (page, data, sessionId) => showPage(page, data, sessionId, ++token),
        retry,
        current: () => current?.page,
    };
};
