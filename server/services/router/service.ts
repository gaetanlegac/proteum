/*----------------------------------
- DEPENDANCES
----------------------------------*/

// Core
import type { Application } from '@server/app';
import Service, { TRegisteredServicesIndex, TServiceArgs } from '@server/app/service';

// Specific
import type { default as Router } from '.';
import type ServerRequest from './request';
import type RequestService from './request/service';
import type { TAnyRouter } from '.';

export type AnyRouterService = RouterService<any, TAnyRouter>;

export type TRouterServiceArgs = [
    getConfig: TServiceArgs<AnyRouterService>[1],
    app: Application,
];

/*----------------------------------
- SERVICE
----------------------------------*/
export default abstract class RouterService<
    TConfig extends {},
    TRouter extends TAnyRouter
> extends Service<TConfig, {}, Application, TRouter> {

    public constructor( ...[config, app]: TRouterServiceArgs) {
        super(app, config, app);
    }

    public abstract requestService( request: ServerRequest<TRouter> ): RequestService | {} | null;

}