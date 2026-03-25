declare module '@/client/pages/\*\*/_layout/index.tsx' {
    const Layout: import('../common/router/layouts').ImportedLayouts;
    export = LayoutsList;
}

declare module '@/client/pages/\*.tsx' {
    const value: import('../client/services/router').TRoutesLoaders;
    export = value;
}

declare module '@/server/services/auth' {
    const UserAuthService: import('../../server/services/auth/base').default;
    export = UserAuthService;
}

declare module '@/server' {
    const ServerApplicationClass: import('../server/app').default;
    export = InstanceType<ServerApplicationClass>;
}

declare module '@/server/index' {
    import ServerApplicationBase from '../server/app';

    export default class ServerApplication extends ServerApplicationBase {}
}

declare module '@/client' {
    const ClientApplicationClass: import('../client/app').default;
    export = InstanceType<ClientApplicationClass>;
}

declare module '@/client/context' {
    const Test: true;

    const ClientRouter: import('../client/services/router').default;
    const ServerRouter: import('../server/services/router').default;

    type TServerRouterRequestContext = import('../server/services/router/response').TRouterContext;
    type TClientRouterRequestContext = import('../client/services/router/response').TRouterContext;

    export type ClientContext =
        // TO Fix: TClientRouterRequestContext is unable to get the right type of CrossPathClient["router"]
        //    (it gets ClientApplication instead of CrossPathClient)
        TClientRouterRequestContext<ClientRouter, ClientRouter['app']> | TServerRouterRequestContext<ServerRouter>;

    export const ReactClientContext: preact.Context<ClientContext>;

    const useContext: () => ClientContext;

    export default useContext;
}

declare module '@app' {
    const ServerApplicationClass: import('../server/app').default;
    export = ServerApplicationClass;
}
