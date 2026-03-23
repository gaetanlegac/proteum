# Server Services

Stack:
- Typescript with strict mode
- NodeJS
- Prisma 7 ORM

## Catalog placement

- Server-only catalogs and registries live in `/server/catalogs/**`
- Shared cross-runtime catalogs live in `/common/catalogs/**`
- Do not create nested `catalogs/` folders under `/server/services/**`
- Services should import curated lists from those root catalog locations instead of redefining them locally

## 1. Create the service file in `/server/services/<service name>/index.ts`

Template:

```typescript
/*----------------------------------
- DEPENDANCE
----------------------------------*/

// Core libs
import Service from '@server/app/service';

/*----------------------------------
- TYPES
----------------------------------*/

export type Config = Record<string, never>;

/*----------------------------------
- SERVICE
----------------------------------*/

export default class ServiceName extends Service<Config, {}, AppType, ParentServiceType> {

    public async methodName(data: { param1: string }) {
        return this.services.OtherService.otherMethod(data);
    }
}
```

Replace `AppType` and `ParentServiceType` with the local app types used by neighboring services.
If the service receives config from a project config file, replace `Config` with the real config shape and expose a typed
config export with `Services.config(ServiceName, { ... })` from `server/config/*.ts`.

## 2. Create the controller file in `/server/controllers/...`

Template:

```typescript
import Controller, { schema } from '@server/app/controller';

const MethodInput = schema.object({
    param1: schema.string(),
});

export default class ServiceNameController extends Controller<AppType> {

    public async methodName() {
        const input = this.input(MethodInput);
        const currentUser = this.request.auth.check('USER', null);

        return this.services.ServiceName.methodName({
            ...input,
            currentUser,
        });
    }
}
```

Replace `AppType` with the local app type if the surrounding controllers use a generic.
Place the controller under the path that should drive the public API shape, for example `/server/controllers/ServiceName.ts` or `/server/controllers/ServiceName/subFeature.ts`.

Rules:
- Only files under `/server/controllers/**/*.ts` are indexed as callable API endpoints
- Route path is derived from the controller file path and the method name
- `this.input(schema)` is the only validation entrypoint
- Call `this.input(...)` at most once per controller method
- Request-scoped state exists only on `this.request`
- Keep controllers thin and push business logic into services
- Extract auth and request-derived values in the controller and pass explicit typed arguments into services

## 3. Create the service metas file in `/server/services/<service name>/service.json`

```json
{
    "id": "<AppIdentifier>/ServiceName",
    "name": "ServiceName",
    "parent": "app",
    "dependences": []
}
```

Use the same id namespace and naming convention as neighboring services in the project.

## 4. Add a typed config export in `/server/config/*.ts` and instantiate the service in `/server/index.ts`

```typescript
// server/config/feature.ts
import { Services } from '@server/app';
import ServiceName from '@/server/services/ServiceName';

export const serviceNameConfig = Services.config(ServiceName, {});
```

```typescript
// server/index.ts
import { Application } from '@server/app';
import ServiceName from '@/server/services/ServiceName';
import * as featureConfig from '@/server/config/feature';

export default class MyApp extends Application {
    public ServiceName = new ServiceName(this, featureConfig.serviceNameConfig, this);
}
```

Match the existing config-grouping and namespace-import convention in the project instead of inventing a new bootstrap shape.

## 5. Keep classes clean

If the class grows too large, split business concerns into subservices.

## 6. Use request-aware features only in controllers

Use:

```typescript
const { auth, request, user, response } = this.request;
```

- Never import runtime request state from `@request`
- Never access request-scoped state inside normal service methods
- If a service needs user identity, locale, cookies, or another request-derived value, compute it in the controller and pass only that value

## 7. Fetch and return data from the database

Use runtime models through `this.models`:

```typescript
const users = await this.models.user.findMany({
    select: {
        id: true,
    },
});
```

Use prisma typings through `@models/types` only:

```typescript
import type * as Models from '@models/types';
```

Rules:
- Never edit prisma files, except the schema
- Never use runtime `@models` imports
- If you need generated runtime Prisma enums or helpers already emitted by Proteum, follow the local `@generated/server/models` import pattern
- In all queries and joins, always specify what fields to select

## DTO and typing rules

- Prefer inferred return types:
`export type TResult = Awaited<ReturnType<MyService["MethodName"]>>;`
- Never create manual DTO types when the exact return type can be inferred

## Errors handling

Never silence caught errors. Throw `Anomaly` with enough detail and the original error when needed.
