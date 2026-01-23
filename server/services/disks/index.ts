/*----------------------------------
- DEPS
----------------------------------*/

// Core
import type { Application } from '@server/app';
import Service, { AnyService, TRegisteredServicesIndex, TServiceArgs } from '@server/app/service';

// Specific
import type Driver from './driver';
export type { default as Driver } from './driver';

/*----------------------------------
- TYPES
----------------------------------*/

type Config = {
    debug: boolean,
    default: string,//keyof MountpointList,
    drivers: {
        [driverId: string]: Driver
    }
}

export type Hooks = {

}

export type Services = {
    [diskId: string]: Driver
}

/*----------------------------------
- SERVICE
----------------------------------*/
export default class DisksManager<
    MountpointList extends Services,
    TConfig extends Config,
    TApplication extends Application
> extends Service<TConfig, Hooks, TApplication, TApplication> {

    public default!: Driver;

    /*----------------------------------
    - LIFECYCLE
    ----------------------------------*/

    public constructor( ...args: TServiceArgs<DisksManager<MountpointList, TConfig, TApplication>>) {

        super(...args);

        const drivers = this.config.drivers;
        
        if (Object.keys( drivers ).length === 0)
            throw new Error("At least one disk driver should be mounted.");

        // Bind current instance of the service as parent
        /*for (const driverId in drivers) {
            drivers[driverId].parent = this;
        }*/

        const defaultDisk = drivers[ this.config.default ];
        if (defaultDisk === undefined)
            console.log(`Default disk "${this.config.default as string}" not mounted.`);

        this.default = defaultDisk;

    }

    public async shutdown() {

    }

    /*----------------------------------
    - LIFECYCLE
    ----------------------------------*/

    public get( diskName?: 'default' | keyof MountpointList ): Driver {

        const disk = diskName == 'default' || diskName === undefined
            ? this.default 
            : this.config.drivers[diskName];

        if (disk === undefined)
            throw new Error(`Disk "${diskName as string}" not found.`);

        return disk;
    }

}