# Page Files

This file adds page-file local rules on top of the canonical framework contract:

- framework repo: `agents/framework/AGENTS.md`
- installed app: `./node_modules/proteum/agents/framework/AGENTS.md`

## Router.page Usage

- Prefer `Router.page(path, setup, render)` for normal SSR pages.
- Use `Router.page(path, options, setup, render)` when a separate route-options object makes the call clearer.
- Keep the `Router.page(...)` call compact instead of exploding each outer argument onto its own line.
- Keep route registration at top level. Do not hide it behind helper abstractions.

## Setup And Render

- `setup` returns one flat object.
- `_`-prefixed keys are route options.
- every other key is SSR data and should be consumed from `render`
- if a page needs route data, return it from `setup` and read it in `render`

## Page Rules

- Prefer generated page args or the app context hook. Do not import `.proteum` files directly.
- Never use `api.fetch(...)` in page files.
- Never import client service values from `@app`.
- Keep page-local curated copy, option sets, and registries in `/client/catalogs/**`.
- When shared Shadcn-based primitives exist, compose the page UI from them instead of redefining common controls inline.

## Typings

- Treat generated controller method typings as the source of truth.
- Never cast controller methods, their parameters, or their return types.
