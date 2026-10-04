# Page Contract

This is the canonical page-file contract for Proteum-based projects.
Role: keep only page-file rules here.
Keep here: `definePageRoute(...)` and `defineErrorRoute(...)`, SSR `data` and `render` contracts, page payload shape, and page-local typing rules.
Do not put here: generic component rules, server/service implementation details, or app-wide workflow already covered by broader AGENTS files.

Optimization source of truth: root-level `optimizations.md`.
Diagnostics source of truth: root-level `diagnostics.md`.
Coding style source of truth: root-level `CODING_STYLE.md`.

## Page Definition Usage

- Proteum page files default-export `definePageRoute({ path, options, data, render })` or `defineErrorRoute({ code, options, render })`.
- File path controls chunk identity and layout discovery; route URL comes from the explicit `path` value.
- `options` is always required and must be an object.
- `data` is the only nullable route field. Pass `null` when the page does not need SSR data.
- Keep route metadata static and serializable. Runtime app/client references belong only inside `data` and `render`.
- Do not import `@app`, `@/client/router`, or `@client/router` in page files.

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

## Data And Render

- Route behavior belongs in the explicit `options` object, not in page data.
- `data` returns one flat object, or the route definition sets `data: null` when no page data is needed.
- Returning route-option keys such as `auth`, `layout`, `static`, `redirectLogged`, or their `_`-prefixed variants from `data` is a contract error.
- Controller fetchers and promises returned from `data` resolve before render, except on a deferred page (below). Only controller fetchers reach the server; other promises resolve in the browser and plain values skip the round trip. Both go through JSON, as SSR data does. A loader without any controller fetcher sends no request on a client navigation.
- If a page needs route data, return it from `data` and read it in `render`.

## Blocking And Deferred Navigation

- Blocking is the default: a client navigation fetches the page data, then swaps the page in. Render reads resolved data only.
- `options: { navigation: 'deferred' }` swaps the page in before its data, but only when the router config sets `navigation: { mode: 'deferred' }` and the page has a `data` loader. Otherwise the page stays blocking and its `navigation` prop is always `ready`.
- A deferred render receives every data key as `T | undefined` and a `navigation` prop: `status` (`ready`, `pending`, `error`), `pending`, `stale` (previous data still on screen), `reloading` (that data is this page's own: `api.reload`, or `retry()` after ready), `error`, `since`, `retry()`. Render the skeleton while data is missing, the previous data while `stale`, and an error with `navigation.retry()` on `error`. A render that reads the URL beside its data keeps stale data only while `reloading`.
- A deferred page cannot return a data key named `navigation`. Blocking pages may.
- Keep pages blocking when they redirect or throw on their data, and for public full-load pages.
- `api.reload(...)` on a deferred page re-runs only its data step through `navigation.retry()` and merges the result into the page state, keeping `api.set` values.
- `page.ready` fires once per navigation, when its data is first on screen, including after a `retry()` that recovers a failed first data step; never for later retries or reloads.
- Full contract: `node_modules/proteum/docs/client-navigation.md`.

```tsx
export default definePageRoute({
    path: '/radars',
    options: { auth: true, navigation: 'deferred' },
    data: ({ Radars }) => ({ radars: Radars.list() }),
    render: ({ radars, navigation }) =>
        radars === undefined ? <RadarsSkeleton navigation={navigation} /> : <RadarsPage radars={radars} />,
});
```

## Page Rules

- Prefer generated page args or the app client context. Do not import `.proteum` implementation files directly.
- Never use `api.fetch(...)` in page files for SSR loading.
- Never import client service values from `@app`.
- Keep page-local curated copy, option sets, and registries in `/client/catalogs/**`.
- When shared Shadcn-based primitives exist, compose the page UI from them instead of redefining common controls inline.

## Typings

- Treat generated controller method typings as the source of truth.
- Never cast controller methods, their parameters, or their return types.
