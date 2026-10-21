/*----------------------------------
- STALE BUILD RECOVERY
----------------------------------*/

/*
 * A page running an older build asks for chunk files that a deploy removed. The only cure is a
 * fresh document: the new HTML names the new, content-hashed entry files, so a reload loads the
 * new build. One reload per build id, kept in sessionStorage, so a chunk that is missing in the
 * new build too (a deploy race, a CDN that kept a 404) ends on the error instead of a loop.
 */

export const STALE_BUILD_RELOAD_KEY = 'proteum:stale-build-reload';

type TReloadStorage = Pick<Storage, 'getItem' | 'setItem'>;

export type TStaleBuildReloadOptions = {
    storage?: () => TReloadStorage;
    reload?: () => void;
};

// The shapes rspack's runtime rejects with: `ChunkLoadError` for a JS chunk, the code for a CSS chunk.
export const isChunkLoadError = (error: Error) =>
    error.name === 'ChunkLoadError' || ('code' in error && error.code === 'CSS_CHUNK_LOAD_FAILED');

/**
 * Reloads the page once for `buildId` and returns true, or returns false when this build already
 * reloaded once in this tab, or when sessionStorage is unavailable (no guard means no reload).
 */
export const reloadOnceForStaleBuild = (
    buildId: string,
    {
        storage = () => window.sessionStorage,
        reload = () => window.location.reload(),
    }: TStaleBuildReloadOptions = {},
): boolean => {
    try {
        const store = storage();
        if (store.getItem(STALE_BUILD_RELOAD_KEY) === buildId) return false;

        store.setItem(STALE_BUILD_RELOAD_KEY, buildId);
    } catch (error) {
        // Storage blocked (private mode, sandboxed frame, quota): without the guard a reload could loop
        console.warn('Stale build recovery skipped: sessionStorage is unavailable.', error);
        return false;
    }

    reload();
    return true;
};
