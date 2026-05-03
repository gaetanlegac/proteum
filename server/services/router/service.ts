/*----------------------------------
- DEPENDANCES
----------------------------------*/

// Core
import type { Application } from '@server/app/index';
import Service, { TSetupConfig } from '@server/app/service';

// Specific
import type ServerRequest from './request';
import type { TAnyRouter } from '.';

export type AnyRouterService = Service<{}, {}, Application, object> & {
    requestService(request: object): object | null;
};

export type TRouterServiceArgs<TConfig extends {} = {}> = [
    getConfig: TSetupConfig<TConfig> | null | undefined,
    app: Application,
];

/*----------------------------------
- SERVICE
----------------------------------*/
export default abstract class RouterService<
    TConfig extends {},
    TRouter extends TAnyRouter,
    TRequestService extends object | null = object | null,
> extends Service<TConfig, {}, Application, object> {
    public declare parent: TRouter;
    public declare app: TRouter extends { app: infer TApplication extends Application } ? TApplication : Application;

    public constructor(...[config, app]: TRouterServiceArgs<TConfig>) {
        super(app, config, app);
    }

    public abstract requestService(request: ServerRequest<TRouter>): TRequestService;
}
