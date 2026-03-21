import fs from 'fs';
import path from 'path';

type TGeneratedRuntimeBundleName = 'routes' | 'controllers';

const generatedRuntimeBundleFiles: Record<TGeneratedRuntimeBundleName, string> = {
    routes: '__proteum_dev_routes.js',
    controllers: '__proteum_dev_controllers.js',
};

// Use Node's native require so the running server can reload freshly compiled
// dev bundles from disk instead of resolving the copies embedded in server.js.
const nativeRequire = eval('require') as NodeJS.Require;

const getGeneratedRuntimeBundlePath = (bundleName: TGeneratedRuntimeBundleName) =>
    path.join(process.cwd(), APP_OUTPUT_DIR, generatedRuntimeBundleFiles[bundleName]);

export const loadGeneratedRuntimeBundle = <T>(bundleName: TGeneratedRuntimeBundleName): T | undefined => {
    if (!__DEV__) return undefined;

    const bundlePath = getGeneratedRuntimeBundlePath(bundleName);
    if (!fs.existsSync(bundlePath)) return undefined;

    const resolvedPath = nativeRequire.resolve(bundlePath);
    delete nativeRequire.cache[resolvedPath];

    const loadedModule = nativeRequire(resolvedPath);
    return (loadedModule.default || loadedModule) as T;
};
