import type ClientApplication from '@client/app';
import type ServerApplication from '@server/app/index';

export type ClientOrServerApplication = ClientApplication | ServerApplication;

export type TAppArrowFunction<
    TRegisteredData = void,
    TApplication extends ClientOrServerApplication = ClientOrServerApplication,
> = (app: TApplication) => TRegisteredData;
