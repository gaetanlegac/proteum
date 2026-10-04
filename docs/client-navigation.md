# Client Navigation

A client navigation runs in one of two modes. **Blocking**, the default, waits for the page data before it swaps the page in. **Deferred** swaps the page in first, with a pending state the page renders as a skeleton, then fills in the data. SSR first loads are the same in both modes: the page arrives with its data.

Deferred navigation is opt-in twice: the router must run in deferred mode, and each page must declare it. An app that sets neither compiles and behaves as before.

## Router Config

```ts
public Router = new Router(this, {
    preload: [],
    // Pages declaring navigation: 'deferred' swap in before their data. Default: { mode: 'blocking' }
    navigation: { mode: 'deferred' },
    // Route paths whose chunks load at idle after the first render
    prefetch: ['/', '/radars', '/sales'],
    context: (context, router) => ({ ...context }),
});
```

`preload` keeps its meanings: the router config glob list, `client/pages/preload.json` (chunks bundled with the entry) and the page option `preload?: boolean`. `prefetch` is a different, runtime list: route paths whose chunks load in the background once the first page is rendered.

## Page Option

```tsx
import { definePageRoute } from '@common/router/definitions';

export default definePageRoute({
    path: '/radars',
    options: { auth: true, navigation: 'deferred' },
    data: ({ Radars }) => ({ radars: Radars.list() }),
    render: ({ radars, navigation }) =>
        radars === undefined ? (
            <RadarsSkeleton error={navigation.error} onRetry={navigation.retry} />
        ) : (
            <RadarsPage radars={radars} dimmed={navigation.pending} />
        ),
});
```

A page defers only when all three hold: the router mode is `deferred`, the page declares `navigation: 'deferred'`, and the page has a `data` loader. Otherwise it navigates in blocking mode, including a page that declares `deferred` under a blocking router; its render then always sees `status: 'ready'`.

`navigation: 'deferred'` changes the render type. `definePageRoute` picks `TDeferredFrontRenderer<T>`: every data key is `T | undefined`, and the render receives a `navigation` prop. Pages without the option keep `TFrontRenderer<T>` and receive no `navigation` prop, so a blocking page may still return a data key named `navigation`. A deferred page may not: its data loader throws if it returns that key. The blocking overload accepts `navigation: 'blocking'` or no option, never `'deferred'`: a deferred page whose render does not fit the deferred renderer (an annotated props type with defined keys) is a type error, not a blocking page in disguise.

## Navigation State

`navigation` is a `TPageNavigation`, discriminated on `status`:

| status | pending | stale | reloading | error | Meaning |
| --- | --- | --- | --- | --- | --- |
| `ready` | `false` | `false` | `false` | `null` | The data of this page is on screen |
| `pending` | `true` | `boolean` | `boolean` | `null` | The data step runs |
| `error` | `false` | `boolean` | `boolean` | `Error` | The data step failed |

- `stale: true` means the previous data is still on screen. It happens on a same-chunk navigation (the page component is kept, as in blocking mode) when the previous page showed data, and on a retry of a page that showed data. A cross-chunk navigation remounts the page component: every data key is `undefined` while pending.
- `reloading: true` means the data step runs again for a navigation whose data already reached the screen (`api.reload`, or `retry()` after `ready`): the stale data is this page's own, for this URL. It is `false` on a navigation, even a stale one, and on a retry that recovers a failed first data step. A page whose render reads the URL beside its data can keep its stale data on screen while `reloading`, and only then.
- `since` is the `Date.now()` timestamp of the last status change, for a delayed skeleton or a slow-network hint.
- `retry()` re-runs the data step only: no route resolution, no swap, no loader. It does nothing once the page left the screen.
- `error` is what the data step threw. A request that never reached the server is a `NetworkError` (`@common/errors`); an answer from the server is the error it encoded (`AuthRequired`, `Forbidden`, `Anomaly`...).

`api.reload(ids?, params?)` on a deferred page goes through `navigation.retry()`: the page turns `pending` with `stale: true` and `reloading: true`, then `ready` with the reloaded data. A reload merges what it fetched into the page state, so values written with `api.set` or `page.setData` survive. The first data render of a navigation replaces the state instead, and so does a retry that recovers a failed first data step: until then the page component may still hold the previous page's data (a same-chunk navigation keeps it), which a merge would carry over. On a blocking page `api.reload` keeps its previous behavior.

Layout data reaches the same render props: on a page declaring `deferred`, a layout `data` loader returning a `navigation` key throws like the page loader would.

## Order Of Operations

Both modes start the same way: `page.change` hook, scroll to top, loader on, route chunk load.

Blocking:

1. Data providers run and their data is fetched.
2. The page swaps in with its data. The swap render releases the loader, then `page.changed` and `page.ready` fire.

Deferred:

1. Data providers run, without fetching. A provider that throws aborts the navigation like a blocking data failure.
2. The page swaps in with `status: 'pending'`. `page.changed` fires; the loader stays on.
3. The data is fetched. On success the data and `status: 'ready'` render in one batch, the loader goes off, and after that render the router refreshes the title, body classes and hash scroll, then fires `page.ready`. On failure the page renders `status: 'error'` and the loader goes off.

Whether the swap render was pending is read at that render, not in its effect: data that lands within the frame between the two still fires `page.ready` after the data render, never before it.

Body classes are reset twice on a deferred page: `page.updateClient()` rewrites `document.body.className` (with the body id and the title) from the page at the swap, before `page.changed`, and again after the data render, before `page.ready`. A class the app adds to the body itself is gone after each: re-add it in both `page.changed` and `page.ready`. A blocking page resets them once, before both hooks.

The router context's `page` is the page on screen. It changes when a navigation swaps its page in, never when the route resolves, so a navigation that never commits (superseded, failed) leaves `api.set` and `api.reload` working on the page still shown.

A hash scrolls to the element whose id it names (decoded, looked up with `getElementById`), on a same-page hash change and after the render that shows the data.

Every navigation takes a new token and gives up after any await that returns to an older one: a slower chunk, an error page chunk or an older data response never replaces a newer page, and a deferred page whose provider starts another navigation (a redirect) never swaps in. A deferred data step also gives up once its page left the screen, or when a newer data step for the same page started (retry, reload). A route chunk that fails to load is logged, goes to the app error handler (the "new version" notice) and releases the loader instead of leaving it on.

## Hooks

`router.on(hook, callback)` returns a remover that removes this callback, by reference: a callback registered twice is removed twice by one call. A listener added while its hook runs first runs on the next call of that hook; one removed while the hook runs still runs in that pass.

| Hook | When |
| --- | --- |
| `page.change` | A client navigation starts |
| `page.changed` | The rendered page changed. Fires on the first load too |
| `page.rendered` | Hydration finished (first load only) |
| `page.ready` | The page shows its data: once after hydration, then once per navigation (with the swap on a blocking page, when the data lands on a deferred one) |

Count page views on `page.ready`: it fires for the landing page and once per navigation in both modes. On a deferred page it fires the first time the data of the navigation is on screen, which includes a `retry()` that recovers a failed first data step; it never fires again for a later retry or a reload. A page replaced in the same render as its data render never reaches the screen with its data and does not fire it, as with a blocking page swapped out in the same render.

## Page Data Fetchers

The data step partitions what a `data` loader returns:

- api fetchers (controller calls) go to the server in one `POST /api` batch;
- other promises and thenables resolve in the browser; a rejection goes to the app error handler, like an `/api` failure, then fails the data step;
- plain values are page data with no round trip.

Values resolved in the browser go through JSON (with the circular-safe stringify SSR uses), so a client navigation sees what SSR sees: a `Date` becomes a string, `undefined` keys disappear, `toJSON()` applies, and the page gets its own copy rather than the provider's object.

Only an `/api` call reaches the server. A plain value such as a parsed URL filter or a date key is never echoed through `/api`, and a promise that is not an `/api` call resolves to its value instead of serializing to `{}`.

Behavior note for 2.6.0: a data loader that returns no api fetcher no longer sends any request on a client navigation. Server-side `/api` request hooks, session refresh and 401 detection therefore do not run for such a navigation; a page that relies on them needs at least one controller call in its loader.

## Prefetch

- `router.prefetch(path)` loads the route chunk of `path` and keeps it, without fetching data. A navigation that starts while the chunk loads joins the same load. A failure is silent; the navigation retries the load and reports it.
- `<Link to="/radars" prefetch>` calls it on hover and focus.
- The router config `prefetch` list loads at idle after `page.rendered`, one chunk at a time. Without `requestIdleCallback` (Safari, iOS) it starts 2 seconds after hydration instead, so the page's own requests go first. With data saver on (`navigator.connection.saveData`) the list is not loaded at all; `Link` prefetch on hover still runs, since the visitor is pointing at that page.

## Contracts For Agents

- Blocking stays the default at both levels. Opting a page into `deferred` means its render must handle every data key as possibly `undefined` and render `navigation.status === 'error'` with a retry.
- A provider that throws synchronously aborts before the swap in both modes. A rejected fetch on a deferred page becomes an error state on screen (an `/api` failure still reaches the app error handler first).
- Pages that rely on a redirect or an error page coming from their data, and public full-load pages, should stay blocking.
- Use `page.ready`, not `page.changed`, for anything that needs the page data on screen, such as analytics page views. Read the page's URL from the request the hook passes, not from `window.location`, which may already be the next navigation's.
- An app that adds its own classes to `document.body` re-adds them on `page.ready` as well as `page.changed`: the router resets the body classes before each.
