/*----------------------------------
- DEPENDANCES
----------------------------------*/

// Specific
import type {
    AnyService,
    StartedServicesIndex,
    // Hooks
    THookCallback,
    THooksIndex,
} from '.';

/*----------------------------------
- TYPES: REGISTRATION
----------------------------------*/

// From service/service.json
export type TServiceMetas<TServiceClass extends AnyService = AnyService> = {
    id: string;
    name: string;
    parent: string;
    dependences: string[];
    class: () => { default: ClassType<TServiceClass> };
};

export type TRegisteredService<TServiceClass extends AnyService = AnyService> = {
    type: 'service'; // Used to recognize if an object is a registered service
    config?: {};
    metas: TServiceMetas<TServiceClass>;
    hooks: THooksIndex<{}>;
    on: (hookName: string, hookFunc: THookCallback<any>) => void;
    subServices: TRegisteredServicesIndex;
};

export type TRegisteredServicesIndex<TServiceClass extends AnyService = AnyService> = {
    [serviceId: string]: TRegisteredService<TServiceClass>;
};

/*----------------------------------
- CONFIG
----------------------------------*/

const LogPrefix = '[service]';

/*----------------------------------
- CLASS
----------------------------------*/
export class ServicesContainer<TServicesIndex extends StartedServicesIndex = StartedServicesIndex> {
    public registered: TRegisteredServicesIndex = {};

    // All service instances by service id
    public allServices: TServicesIndex = {} as TServicesIndex;

    public callableInstance = <TInstance extends object, TCallableName extends keyof TInstance>(
        instance: TInstance,
        funcName: TCallableName,
    ): TInstance[TCallableName] & TInstance => {
        const instanceRecord = instance as Record<string, unknown>;
        const callableFunc = instance[funcName];
        if (typeof callableFunc !== 'function') throw new Error(`instance[funcName] isn't callable.`);

        const callable = callableFunc.bind(instance);

        const methods = [
            ...Object.getOwnPropertyNames(Object.getPrototypeOf(instance)),
            ...Object.getOwnPropertyNames(instance),
            // service.launch() isn't included, maybe because parent abstract class
            'launch',
            'bindServices',
        ];

        for (const method of methods)
            if (method !== 'constructor')
                (callable as Record<string, unknown>)[method] =
                    typeof instanceRecord[method] === 'function'
                        ? (instanceRecord[method] as Function).bind(instance)
                        : instanceRecord[method];

        // Allow us to recognize a callable as a service
        callable.serviceInstance = instance;

        return callable as TInstance[TCallableName] & TInstance;
    };
}

export default new ServicesContainer();
