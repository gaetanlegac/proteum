import type Router from '@client/services/router';

const getRouter = (): Router => {
    if (typeof window === 'undefined') {
        throw new Error(
            'Proteum client router was accessed during SSR or server execution. This is a framework contract failure. ' +
                'Likely fix: remove `@/client/router` from server or `.ssr` code and pass request or router data explicitly. ' +
                'Re-check both SSR and client navigation after the fix.',
        );
    }

    const router = (window.app as (Record<string, unknown> & { Router?: Router }) | undefined)?.Router;
    if (!router) {
        throw new Error(
            'Proteum client router was accessed before the browser app finished booting. This is a framework contract failure. ' +
                'Likely fix: call the router from code that runs after App mount or from a component under the Proteum router tree. ' +
                'Re-check both SSR and client navigation after the fix.',
        );
    }

    return router;
};

const ClientRouter = new Proxy({} as Router, {
    get(_target, property) {
        const value = getRouter()[property as keyof Router];
        return typeof value === 'function' ? value.bind(getRouter()) : value;
    },
    set(_target, property, value) {
        ((getRouter() as unknown) as Record<PropertyKey, unknown>)[property] = value;
        return true;
    },
}) as Router;

export default ClientRouter;
