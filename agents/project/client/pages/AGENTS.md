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

## Data And Render

- Route behavior belongs in the explicit `options` object, not in page data.
- `data` returns one flat object or `null` is passed as the third argument when no page data is needed.
- Returning route-option keys such as `auth`, `layout`, `static`, `redirectLogged`, or their `_`-prefixed variants from `data` is a contract error.
- Controller fetchers and promises returned from `data` resolve before render.
- If a page needs route data, return it from `data` and read it in `render`.

## Page Rules

- Prefer generated page args or the app client context. Do not import `.proteum` implementation files directly.
- Never use `api.fetch(...)` in page files for SSR loading.
- Never import client service values from `@app`.
- Keep page-local curated copy, option sets, and registries in `/client/catalogs/**`.
- When shared Shadcn-based primitives exist, compose the page UI from them instead of redefining common controls inline.

## Typings

- Treat generated controller method typings as the source of truth.
- Never cast controller methods, their parameters, or their return types.
