/*----------------------------------
- DEPS
----------------------------------*/

// Core
import type { Application } from '@server/app/index';
import Service, { AnyService, TServiceArgs } from '@server/app/service';

// Specific
import type Driver from './driver';
export type { default as Driver } from './driver';

/*----------------------------------
- TYPES
----------------------------------*/

type Config = {
    debug: boolean;
    default: string; //keyof MountpointList,
    drivers: { [driverId: string]: Driver };
};

export type Hooks = {};

export type Services = { [diskId: string]: Driver };

/*----------------------------------
- SERVICE
----------------------------------*/
export default class DisksManager<
    MountpointList extends Services,
    TConfig extends Config & { default: keyof MountpointList & string; drivers: MountpointList },
    TApplication extends Application,
> extends Service<TConfig, Hooks, TApplication, TApplication> {
    /*----------------------------------
    - LIFECYCLE
    ----------------------------------*/

    public constructor(...args: TServiceArgs<DisksManager<MountpointList, TConfig, TApplication>>) {
        super(...args);

        const drivers = this.config.drivers;

        if (Object.keys(drivers).length === 0) throw new Error('At least one disk driver should be mounted.');

        // Bind current instance of the service as parent
        /*for (const driverId in drivers) {
            drivers[driverId].parent = this;
        }*/

        this.default;
    }

    public get default(): Driver {
        const drivers: Services = this.config.drivers;
        const defaultDisk = drivers[this.config.default];
        if (defaultDisk === undefined) throw new Error(`Default disk "${String(this.config.default)}" not mounted.`);
        return defaultDisk;
    }

    public async shutdown() {}

    /*----------------------------------
    - LIFECYCLE
    ----------------------------------*/

    public get(diskName?: 'default' | keyof MountpointList): Driver {
        const drivers: Services = this.config.drivers;
        const disk =
            diskName === 'default' || diskName === undefined
                ? this.default
                : drivers[String(diskName)];

        if (disk === undefined) throw new Error(`Disk "${String(diskName)}" not found.`);

        return disk;
    }
}
