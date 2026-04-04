# Migrating from Proteum 2.1.3

This guide covers the breaking changes between `proteum@2.1.3` and the current framework code in this repository.

The important conclusion is that the breaking surface is mostly at the app root and tooling contract level, not in day-to-day page, controller, or service authoring. In the repo diff from `2.1.3` to the current `2.1.9` line, I did not find a mandatory rewrite of `Router.page(...)`, controller methods, or normal service method bodies. The required migration is mainly about config files, env, service metadata discovery, and connected-app setup.

## Breaking Changes Summary

### 1. `identity.yaml` is no longer supported

`2.1.3` expected a YAML file at the app root:

- `identity.yaml`

Current Proteum requires a typed TypeScript config:

- `identity.config.ts`

The file must default-export `Application.identity(...)` from `proteum/config`.

### 2. `proteum.config.ts` is now required

`2.1.3` had no app-level setup file for compiler or connected-project config.

Current Proteum requires:

- `proteum.config.ts`

The file must default-export `Application.setup(...)` from `proteum/config`.

This is where app-level framework config now lives, especially:

- `transpile`
- `connect`

### 3. `URL_INTERNAL` is now a required env var

`2.1.3` required:

- `ENV_NAME`
- `ENV_PROFILE`
- `PORT`
- `URL`

Current Proteum also requires:

- `URL_INTERNAL`

The router and SSR runtime now treat the internal base URL as a first-class contract instead of reusing `URL` implicitly.

### 4. `server/services/**/service.json` is no longer part of the contract

In `2.1.3`, Proteum still read service metadata from `server/services/**/service.json`.

Current Proteum reads the service graph from:

- `server/index.ts`
- typed config exports under `server/config/*.ts`

If you still have `service.json` files from a `2.1.3` app, they are obsolete and should be removed.

If you used `priority` there, move that value into the typed service config export with `Services.config(...)`.

### 5. Connected apps must be declared explicitly

Current Proteum adds an explicit connected-project contract in `proteum.config.ts`.

If your app consumes controllers from another Proteum app, you now need:

- `connect.<Namespace>.source`
- `connect.<Namespace>.urlInternal`

There is no namespace-based inference. The producer app must also already be on the new contract because Proteum now expects the producer app root to contain:

- `identity.config.ts`
- `proteum.config.ts`
- generated connected contract files

### 6. `proteum dev` is stricter when connected apps are configured

If `connect` is configured, current `proteum dev` verifies the producer app health endpoint before it declares the server ready.

That means broken or stale connected-app config is now a startup failure, not just a latent runtime problem.

### 7. Human-facing CLI output changed

Current Proteum prints a welcome banner only for the bare `proteum build` and bare `proteum dev` commands, and `proteum dev` now has tracked session files plus `list` and `stop` subcommands.

This is not an app-code migration, but it can break scripts that parse mixed stdout/stderr loosely. Prefer `--json` for automation.

## Migration Checklist

### 1. Upgrade the package

Update the app dependency to the current Proteum version, then reinstall.

### 2. Replace `identity.yaml` with `identity.config.ts`

Create a new root file:

```ts
import { Application } from 'proteum/config';

export default Application.identity({
    name: 'My App',
    identifier: 'MyApp',
    description: 'My Proteum app',
    author: {
        name: 'My Team',
        url: 'https://example.com',
        email: 'team@example.com',
    },
    social: {},
    language: 'en',
    locale: 'en-US',
    maincolor: 'white',
    iconsPack: 'light',
    web: {
        title: 'My App',
        titleSuffix: 'My App',
        fullTitle: 'My App',
        description: 'My Proteum app',
        version: '0.0.1',
    },
});
```

Mapping from the old YAML shape is mostly direct:

- `name` stays `name`
- `identifier` stays `identifier`
- `description` stays `description`
- `author.*` stays `author.*`
- `language`, `locale`, `maincolor`, `iconsPack` keep the same meaning
- `web.*` keeps the same meaning

Then remove the old file:

- `identity.yaml`

### 3. Add `proteum.config.ts`

Create a new root file:

```ts
import { Application } from 'proteum/config';

export default Application.setup({
    transpile: [],
    connect: {},
});
```

If your app does not consume another Proteum app and does not need package transpilation, this empty config is enough.

If your app compiles workspace or source-distributed packages through Proteum, put them in `transpile`.

Example:

```ts
import { Application } from 'proteum/config';

export default Application.setup({
    transpile: ['@acme/components'],
    connect: {},
});
```

### 4. Add `URL_INTERNAL` to `.env`

At minimum, a migrated app now needs:

```dotenv
ENV_NAME=local
ENV_PROFILE=dev
PORT=3010
URL=http://localhost:3010
URL_INTERNAL=http://localhost:3010
```

For many local apps, `URL_INTERNAL` can initially match `URL`.

Use a different internal URL only when the app is reached differently from server-side code than from a browser.

### 5. Remove `service.json` and move metadata into typed config

Delete any legacy files such as:

- `server/services/Foo/service.json`

Current Proteum derives the root service graph from `server/index.ts`, so the real source of truth is now the code that instantiates root services there.

If the old `service.json` carried priority metadata, move it into the typed config export.

Old pattern:

```json
{
    "priority": 5
}
```

New pattern:

```ts
import { Services } from '@server/app';
import MetricsRouter from '@/server/services/utils/Metrics/router';

export const routerMetricsConfig = Services.config(MetricsRouter, {
    priority: 5,
});
```

Then make sure `server/index.ts` instantiates the service explicitly:

```ts
public Router = new Router(this, {
    ...userConfig.routerBaseConfig,
    plugins: {
        metrics: new MetricsRouter(userConfig.routerMetricsConfig, this),
    },
}, this);
```

### 6. Keep `server/index.ts` explicit

Current Proteum expects the installed root services and router plugins to be visible directly in `server/index.ts`.

The migration target is:

- root services are instantiated as class properties on the `Application` subclass
- router plugins are instantiated inside the `Router` config
- typed config values come from `server/config/*.ts`

If your `2.1.3` app relied on legacy discovery metadata, replace that with explicit code.

## Connected-App Migration

This section applies only if one Proteum app consumes controllers from another Proteum app.

### 1. Upgrade the producer app too

A current consumer app expects a producer app root that already has:

- `identity.config.ts`
- `proteum.config.ts`

So a `file:` connected source pointing at an untouched `2.1.3` producer will fail.

### 2. Declare `connect` explicitly in `proteum.config.ts`

Example:

```ts
import { Application } from 'proteum/config';

export default Application.setup({
    connect: {
        Product: {
            source: process.env.PRODUCT_CONNECTED_SOURCE,
            urlInternal: process.env.PRODUCT_URL_INTERNAL,
        },
    },
});
```

### 3. Add the new env vars used by that config

Example:

```dotenv
PRODUCT_CONNECTED_SOURCE=file:../product
PRODUCT_URL_INTERNAL=http://localhost:3020
```

Supported source styles in the current contract are:

- `file:../relative-producer-app`
- `github:owner/repo?ref=<ref>&path=proteum.connected.json`

### 4. Expect stricter startup behavior

When `connect` is configured, `proteum dev` now checks the producer health endpoint before it reports ready.

If startup fails, validate in this order:

1. The producer app has already been migrated.
2. `connect.<Namespace>.source` points at the right producer app root.
3. `connect.<Namespace>.urlInternal` points at the producer dev server.
4. The producer app is running.
5. `npx proteum connect --strict` passes in the consumer app.

## Monorepo and Workspace Notes

Current Proteum is better at resolving hoisted and workspace installs than `2.1.3`, but old app tsconfig files often still hardcode shallow `node_modules` paths.

If your app lives inside a monorepo and TypeScript path resolution starts failing after the upgrade, align `client/tsconfig.json` and `server/tsconfig.json` with the current scaffold shape:

- include `../identity.config.ts` and `../proteum.config.ts` in the server tsconfig
- make sure the `extends` path points to the real visible `proteum/tsconfig.common.json`
- make sure the `@client/*`, `@common/*`, and `@server/*` aliases point to the real visible Proteum install
- make sure Preact compat aliases include `react-dom/client` when your app imports it

This is usually only needed for workspace or hoisted installs. Standalone apps with a local `node_modules/proteum` often keep working after the config-file migration alone.

## CLI and Workflow Changes

These are worth updating even though they are not core app-code migrations.

### Use `--json` for automation

Only bare `proteum build` and bare `proteum dev` runs print a banner. For scripts, CI helpers, or editor tooling, prefer:

- `npx proteum explain --json`
- `npx proteum doctor --json`
- `npx proteum connect --json`

### Use tracked dev sessions

Current `proteum dev` supports tracked session management:

- `npx proteum dev --session-file var/run/proteum/dev/app.json --replace-existing`
- `npx proteum dev list --json`
- `npx proteum dev stop --session-file var/run/proteum/dev/app.json`

If your local workflow starts multiple dev servers, this is the current supported model.

### New diagnostics are available

These are new capabilities, not migration requirements, but they are the fastest way to validate the upgrade:

- `npx proteum connect --strict`
- `npx proteum explain --connected --controllers`
- `npx proteum diagnose / --port <port>`
- `npx proteum perf top --port <port>`
- `npx proteum trace latest --port <port>`

## Recommended Migration Order

1. Upgrade the package.
2. Convert `identity.yaml` to `identity.config.ts`.
3. Add `proteum.config.ts`.
4. Add `URL_INTERNAL`.
5. Delete all legacy `service.json` files.
6. Move any legacy service metadata, especially `priority`, into `Services.config(...)`.
7. Confirm `server/index.ts` explicitly instantiates every root service and router plugin.
8. If the app is connected to another app, migrate the producer app and then add explicit `connect` config.
9. If the app is inside a workspace, align tsconfig paths with the actual Proteum install location.
10. Run `npx proteum refresh`, then validate with the commands below.

## Validation After Migration

Run these from the migrated app:

```bash
npx proteum refresh
npx proteum explain --env
npx proteum doctor --contracts --strict
npx proteum check
```

If the app uses connected projects, also run:

```bash
npx proteum connect --strict
npx proteum explain --connected --controllers
```

Then boot the app and verify the live runtime:

```bash
npx proteum dev --port 3010
npx proteum diagnose / --port 3010
npx proteum trace latest --port 3010
```

## Short Version

If you want the shortest possible migration plan:

1. Replace `identity.yaml` with `identity.config.ts`.
2. Add `proteum.config.ts`.
3. Add `URL_INTERNAL`.
4. Delete `server/services/**/service.json`.
5. Move any service `priority` into `Services.config(...)`.
6. If you connect apps together, declare `connect.<Namespace>.source` and `connect.<Namespace>.urlInternal` explicitly.

That is the minimum needed to move a real `2.1.3` app onto the current Proteum contract.
