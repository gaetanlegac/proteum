import type Router from '@client/services/router';

const getRouter = (): Router => {
    if (typeof window === 'undefined') {
        throw new Error(`Client router is not available on the server.`);
    }

    const router = (window.app as (Record<string, unknown> & { Router?: Router }) | undefined)?.Router;
    if (!router) {
        throw new Error(`Client router was accessed before the application booted.`);
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
