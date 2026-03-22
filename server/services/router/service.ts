/*----------------------------------
- DEPENDANCES
----------------------------------*/

// Core
import type { Application } from '@server/app/index';
import Service, { TSetupConfig } from '@server/app/service';

// Specific
import type { default as Router } from '.';
import type ServerRequest from './request';
import type { TAnyRouter } from '.';

export type AnyRouterService = RouterService<any, TAnyRouter, object | null>;

export type TRouterServiceArgs<TConfig extends {} = {}, TRouter extends TAnyRouter = TAnyRouter> = [
    getConfig: TSetupConfig<TConfig> | null | undefined,
    app: TRouter['app'],
];

/*----------------------------------
- SERVICE
----------------------------------*/
export default abstract class RouterService<
    TConfig extends {},
    TRouter extends TAnyRouter = TAnyRouter,
    TRequestService extends object | null = object | null,
> extends Service<TConfig, {}, TRouter['app'], TRouter> {
    public constructor(...[config, app]: TRouterServiceArgs<TConfig, TRouter>) {
        super(app as TRouter['app'] & TRouter, config, app);
    }

    public abstract requestService(request: ServerRequest<TRouter>): TRequestService;
}
