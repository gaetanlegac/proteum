/*----------------------------------
- DEPENDANCES
----------------------------------*/

// Specific
import type { AnyServiceClass, StartedServicesIndex } from '.';

/*----------------------------------
- TYPES
----------------------------------*/

type ConstructorConfig<TServiceClass extends AnyServiceClass> = ConstructorParameters<TServiceClass> extends [
    _parent: object | 'self',
    config: infer TConfig,
    _app: object | 'self',
    ..._rest: []
]
    ? NonNullable<TConfig>
    : ConstructorParameters<TServiceClass> extends [config: infer TConfig, _app: object | 'self', ..._rest: []]
      ? NonNullable<TConfig>
      : {};

export type ServiceConfig<TServiceClass extends AnyServiceClass> = ConstructorConfig<TServiceClass>;

/*----------------------------------
- CLASS
----------------------------------*/
export class ServicesContainer<TServicesIndex extends StartedServicesIndex = StartedServicesIndex> {
    public config<TServiceClass extends AnyServiceClass, const TConfig extends ServiceConfig<TServiceClass>>(
        _serviceClass: TServiceClass,
        config: TConfig,
    ): TConfig {
        return config;
    }

    public callableInstance = <TInstance extends object, TCallableName extends keyof TInstance>(
        instance: TInstance,
        funcName: TCallableName,
    ): TInstance[TCallableName] & { serviceInstance: TInstance } => {
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

        return callable as TInstance[TCallableName] & { serviceInstance: TInstance };
    };
}

export default new ServicesContainer();
