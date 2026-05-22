# Migrating To Proteum 2.5

Proteum 2.5 is a breaking cleanup release. It removes contextual app/router magic from user source and makes routes, controllers, pages, services, and app bootstrap machine-readable through explicit definition objects.

## What Changed

- App roots default-export `defineApplication({ services, router, models, commands })`.
- Page files default-export `definePageRoute({ path, options, data, render })` or `defineErrorRoute({ code, options, render })`.
- Manual HTTP route files default-export `defineServerRoute({ method, path, options, handler })` or `defineServerRoutes(...)`.
- Raw Express handlers are wrapped with `expressHandler(...)`.
- Controller files default-export `defineController({ path, actions })`; actions use `defineAction({ input, handler })`.
- Runtime app, service, router, request, response, auth, and router-plugin access comes from typed callback context.
- `@app` imports, top-level `Router.page(...)`, top-level server `Router.*(...)`, controller classes, and `this.input(...)` are no longer supported.

## 1. Install The Published Package

Update every Proteum app package in the repo to `proteum@^2.5.0`, then reinstall from npm.

```bash
npm install
npm ls proteum
node -p "require('./node_modules/proteum/package.json').version + ' ' + require.resolve('proteum/package.json')"
```

The resolved path must point inside the app repo `node_modules/proteum`, not to a local framework checkout. If a project was using `npm link`, the reinstall should replace the symlink.

## 2. Refresh Agent Instructions

Regenerate project instructions so LLMs receive the explicit 2.5 contracts.

```bash
npx proteum configure agents
```

Generated instructions should mention `defineApplication`, `definePageRoute`, `defineServerRoute`, `defineController`, and the ban on `@app` imports in route, page, and controller files.

## 3. Migrate `server/index.ts`

Move from an `Application` subclass or service-returned `Router` to an explicit app definition. Keep `server/index.ts` as the canonical type root for services, router plugins, models, and request context.

```ts
import { defineApplication, type Application } from '@server/app';
import Router from '@server/services/router';
import SchemaRouter from '@server/services/schema/router';
import BillingService from '@/server/services/Billing';

import * as appConfig from '@/server/config/app';

type ProjectServices = {
    Billing: BillingService;
};

type ProjectRouterPlugins = {
    schema: SchemaRouter;
};

export type ProjectRouter = Router<ProjectApp, ProjectRouterPlugins>;
export interface ProjectApp extends Application, ProjectServices {
    Router: ProjectRouter;
}

const createProjectRouter = (app: ProjectApp): ProjectRouter =>
    new Router<ProjectApp, ProjectRouterPlugins>(
        app,
        {
            ...appConfig.routerBaseConfig,
            plugins: {
                schema: new SchemaRouter({}, app),
            },
        },
        app,
    );

const ProjectApplication = defineApplication<ProjectServices, ProjectRouter>({
    services: (app) => ({
        Billing: new BillingService(app, {}, app),
    }),
    router: createProjectRouter,
});

export default ProjectApplication;
```

## 4. Migrate Pages

Replace legacy page registration with a default-exported page definition.

```tsx
import { definePageRoute } from '@common/router/definitions';

export default definePageRoute({
    path: '/dashboard',
    options: { auth: true },
    data: ({ AccountController }) => ({
        account: AccountController.accountPage(),
    }),
    render: ({ account }) => <Dashboard account={account} />,
});
```

Rules:

- `path`, `options`, and error `code` must be static and compiler-readable.
- Route behavior belongs in `options`, not in data.
- Use `data: null` when no SSR data is needed.
- Runtime references are allowed only inside `data` and `render`.

## 5. Migrate Manual Server Routes

Replace top-level `Router.get(...)`, `Router.post(...)`, `Router.express(...)`, and similar calls with definition exports.

```ts
import { defineServerRoute, defineServerRoutes, expressHandler } from '@common/router/definitions';
import type { ProjectApp } from '@/server/index';

export default defineServerRoutes((app: ProjectApp) => [
    defineServerRoute({
        method: 'GET',
        path: '/health',
        options: {},
        handler: ({ response }) => response.json({ ok: true }),
    }),
    defineServerRoute({
        method: 'POST',
        path: '/webhook',
        options: {},
        handler: expressHandler((request, response) => {
            app.Billing.recordWebhook(request.body);
            response.status(204).send('');
        }),
    }),
]);
```

Use `defineServerRoutes((app) => [...])` only when the route definitions need app services at registration time. Otherwise export one `defineServerRoute(...)`.

## 6. Migrate Controllers

Replace controller classes and `this.input(schema)` with explicit actions.

```ts
import { defineAction, defineController, schema } from '@server/app/controller';

export default defineController({
    path: 'Billing',
    actions: {
        read: defineAction({
            input: schema.object({ accountId: schema.string() }),
            handler: ({ input, services }) => services.Billing.read(input.accountId),
        }),
    },
});
```

Rules:

- `input` is parsed before the handler runs.
- Read parsed input from `context.input`.
- Read request state from `request`, `response`, `api`, `auth`, and router-plugin context.
- Call business logic through `services`, `models`, or `app`.

## 7. Remove Legacy Magic

Search user source for old contracts and remove every match.

```bash
rg -n "from ['\"]@app['\"]|Router\\.(page|error|get|post|put|patch|delete|express)\\(|this\\.input\\(" client server common commands
```

Expected result: no user-source matches.

Allowed replacements:

- `ctx.app`, `ctx.services`, `ctx.Router`, `ctx.request`, `ctx.response`, `ctx.auth`, and custom router-plugin context inside handlers.
- `this.app`, `this.services`, and `this.models` inside typed services.
- `defineServerRoutes((app) => [...])` when server route definitions need app services.

## 8. Standardize Caught Error Handling

Every caught error must end at the same framework error surface. Local UI feedback or protocol responses can still happen, but they are not the terminal error handling step by themselves.

Server rules:

- Use `throw error` when the request/router/controller should fail and let Proteum render the HTTP error response.
- Use `await app.reportError(error, request)` when a Proteum request is available, or `await app.reportError(error)` for detached/custom Express paths, catch-and-continue server work, and jobs that intentionally keep running.
- Do not use raw `app.runHook('error', error, request)` in app code. `app.reportError(...)` keeps the `error` versus `error.<code>` routing centralized.

Client rules:

- Use `throw error` when the action should fail and reach the app-level unhandled rejection path.
- Use `useContext().app.handleError(error)` or `context.app.handleError(error)` when the UI catches and continues.
- `handleError` accepts unknown caught values and returns a displayable message. Prefer `setError(context.app.handleError(error, 'Unable to finish this action.'))` over local `instanceof Error` filtering.
- If an app overrides `handleError`, update it to `handleError(error: unknown, fallbackMessage?: string): string` and return the display message.
- Toasts, form errors, or `setError(...)` are local feedback only. Route the original caught value through `app.handleError(error)` or `throw error`.

Do not treat `console.error(error)`, `console.warn(error)`, or any other `console.*(error)` call as error handling. Console calls can be temporary diagnostics, but they must not be the last stop for a caught error.

## 9. Refresh Generated Artifacts

Do not edit `.proteum/**` manually. Regenerate it from source.

```bash
npx proteum refresh
npx proteum typecheck
```

If connected local projects are used through `file:` sources, start or validate producer apps before validating the consumer.

## 10. Validate Runtime Behavior

Run the smallest trustworthy checks first, then broaden when the touched surface requires it.

```bash
npx proteum diagnose /
npx proteum build --prod
npx proteum e2e
```

For protected flows, prefer Proteum session helpers over automating login unless login is the feature under test.

## Common Fixes

- Production route-generation errors where top-level `Router.express(...)` was lifted outside registration are fixed by moving the route into `defineServerRoute({ handler: expressHandler(...) })`.
- `@app` import errors are fixed by moving runtime access into `data`, `render`, route handlers, controller action handlers, or typed services.
- Missing `this.app.Router` typings are fixed by exporting the concrete app and router types from `server/index.ts`.
- Static metadata errors are fixed by moving runtime-dependent values out of `path`, `method`, `options`, and error `code`.
