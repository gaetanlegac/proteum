/*----------------------------------
- DEPENDANCES
----------------------------------*/

// Core
import { TAnyRoute } from '..';
import type BaseRequest from '@common/router/request';

/*----------------------------------
- TYPES
----------------------------------*/

export type TResponseData = unknown;

/*----------------------------------
- CONTEXT
----------------------------------*/
export default abstract class BaseResponse<
    TData extends TResponseData = TResponseData,
    TRequest extends BaseRequest = BaseRequest,
> {
    public data?: TData;
    public request: TRequest;
    public route?: TAnyRoute;

    public constructor(request: TRequest) {
        // ServerResponse et ClientResponse assignent request.response
        request.response = this;
        this.request = request as TRequest;
    }

    public setRoute(route: TAnyRoute) {
        this.route = route;
        return this;
    }

    public abstract redirect(url: string, code?: number, absolute?: boolean): unknown;
}
