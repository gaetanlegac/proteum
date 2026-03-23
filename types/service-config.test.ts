import { Services, type ServiceConfig } from '@server/app';
import Service from '@server/app/service';
import Router from '@server/services/router';

type Assert<T extends true> = T;

type Equals<TLeft, TRight> = (<T>() => T extends TLeft ? 1 : 2) extends <T>() => T extends TRight ? 1 : 2
    ? (<T>() => T extends TRight ? 1 : 2) extends <T>() => T extends TLeft ? 1 : 2
        ? true
        : false
    : false;

class ExampleService extends Service<
    {
        enabled: boolean;
        nested: { count: number };
    },
    {}
> {}

const exampleConfig = Services.config(ExampleService, {
    enabled: true,
    nested: { count: 1 },
});

type RouterBaseConfig = Omit<ServiceConfig<typeof Router>, 'plugins'>;

type _AssertLiteralEnabled = Assert<Equals<typeof exampleConfig.enabled, true>>;
type _AssertLiteralNestedCount = Assert<Equals<typeof exampleConfig.nested.count, 1>>;
type _AssertRouterBaseConfigExtendsObject = Assert<RouterBaseConfig extends object ? true : false>;

// @ts-expect-error Services.config should reject unknown top-level config keys.
Services.config(ExampleService, { enabled: true, nested: { count: 1 }, extra: true });

// @ts-expect-error Services.config should reject unknown nested config keys.
Services.config(ExampleService, { enabled: true, nested: { count: 1, extra: true } });

// @ts-expect-error Services.config should reject invalid property types.
Services.config(ExampleService, { enabled: 'yes', nested: { count: 1 } });
