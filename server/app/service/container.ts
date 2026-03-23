/*----------------------------------
- DEPENDANCES
----------------------------------*/

// Specific
import type { AnyService, AnyServiceClass, StartedServicesIndex } from '.';

/*----------------------------------
- TYPES
----------------------------------*/

// From service/service.json
export type TServiceMetas<TServiceClass extends AnyService = AnyService> = {
    id: string;
    name: string;
    parent: string;
    dependences: string[];
    class: () => { default: ClassType<TServiceClass> };
};

export type ServiceConfig<TServiceClass extends AnyServiceClass> = NonNullable<ConstructorParameters<TServiceClass>[1]>;

type ExactConfig<TValue, TShape> = TValue extends TShape
    ? TShape extends (...args: never[]) => infer _TReturn
        ? TValue
        : TValue extends readonly (infer TValueItem)[]
          ? TShape extends readonly (infer TShapeItem)[]
            ? readonly ExactConfig<TValueItem, TShapeItem>[]
            : never
          : TValue extends object
            ? TShape extends object
                ? Exclude<keyof TValue, keyof TShape> extends never
                    ? { [K in keyof TValue]: K extends keyof TShape ? ExactConfig<TValue[K], TShape[K]> : never }
                    : never
                : TValue
            : TValue
    : never;

/*----------------------------------
- CLASS
----------------------------------*/
export class ServicesContainer<TServicesIndex extends StartedServicesIndex = StartedServicesIndex> {
    // All service instances by service id
    public allServices: TServicesIndex = {} as TServicesIndex;

    public config<TServiceClass extends AnyServiceClass, const TConfig extends ServiceConfig<TServiceClass>>(
        _serviceClass: TServiceClass,
        config: TConfig & ExactConfig<TConfig, ServiceConfig<TServiceClass>>,
    ): TConfig {
        return config;
    }

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
