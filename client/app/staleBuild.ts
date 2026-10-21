/*----------------------------------
- STALE BUILD RECOVERY
----------------------------------*/

/*
 * A page running an older build asks for chunk files that a deploy removed. The only cure is a
 * fresh document: the new HTML names the new, content-hashed entry files, so a reload loads the
 * new build. One reload per build id, kept in sessionStorage, so a chunk that is missing in the
 * new build too (a deploy race, a CDN that kept a 404) ends on the error instead of a loop.
 *
 * - Every build id that reloaded is kept, not only the last one: during a rollout two builds can
 *   answer at once, and a single slot let the tab bounce between them for as long as it lasted.
 * - A route chunk that loads clears the list, so a reload spent on a network blip does not take
 *   the recovery away from the real deploy that comes later in the same tab.
 * - Offline, a chunk fails because there is no network, not because the build is gone: no reload,
 *   which would only swap the page for the browser's offline screen.
 */

export const STALE_BUILD_RELOAD_KEY = 'proteum:stale-build-reload';

// A rollout overlaps two builds at most; the cap only bounds what a long-lived tab can store
const MAX_RELOADED_BUILDS = 5;

type TReloadStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export type TStaleBuildReloadOptions = {
    storage?: () => TReloadStorage;
    reload?: () => void;
    isOnline?: () => boolean;
};

const defaultStorage = () => window.sessionStorage;

const readReloadedBuilds = (store: TReloadStorage) => (store.getItem(STALE_BUILD_RELOAD_KEY) || '').split(',').filter(Boolean);

// The shapes rspack's runtime rejects with: `ChunkLoadError` for a JS chunk, the code for a CSS chunk.
export const isChunkLoadError = (error: Error) =>
    error.name === 'ChunkLoadError' || ('code' in error && error.code === 'CSS_CHUNK_LOAD_FAILED');

/**
 * Reloads the page once for `buildId` and returns true, or returns false when this build already
 * reloaded in this tab, when the browser is offline, or when sessionStorage is unavailable (no
 * guard means no reload).
 */
export const reloadOnceForStaleBuild = (
    buildId: string,
    {
        storage = defaultStorage,
        reload = () => window.location.reload(),
        isOnline = () => window.navigator.onLine !== false,
    }: TStaleBuildReloadOptions = {},
): boolean => {
    if (!isOnline()) return false;

    try {
        const store = storage();
        const reloaded = readReloadedBuilds(store);
        if (reloaded.includes(buildId)) return false;

        store.setItem(STALE_BUILD_RELOAD_KEY, [...reloaded, buildId].slice(-MAX_RELOADED_BUILDS).join(','));
    } catch (error) {
        // Storage blocked (private mode, sandboxed frame, quota): without the guard a reload could loop
        console.warn('Stale build recovery skipped: sessionStorage is unavailable.', error);
        return false;
    }

    reload();
    return true;
};

/** A route chunk loaded: the running build is whole, so a later missing chunk gets its reload again. */
export const clearStaleBuildReloads = (storage: () => TReloadStorage = defaultStorage) => {
    try {
        const store = storage();
        if (store.getItem(STALE_BUILD_RELOAD_KEY) !== null) store.removeItem(STALE_BUILD_RELOAD_KEY);
    } catch (error) {
        // Nothing to clear when storage is blocked: the reload was never granted either
        console.warn('Stale build recovery could not reset its guard.', error);
    }
};
