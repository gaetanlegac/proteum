# Page files

Page files are located in `/client/pages/**/*.tsx`.

## Router.page contract

Use one of these forms:

```typescript
Router.page('/path', ({ request, Feature }) => <Page />);
```

```typescript
Router.page('/path', ({ Feature }) => ({
    _auth: 'USER',
    dataKey: Feature.loadData({ param1: 'value' }),
}), ({ request, dataKey, Feature }) => <Page data={dataKey} />);
```

- Keep the `Router.page(...)` call itself compact instead of expanding each argument onto its own outer line.
- `setup` is the second `Router.page` argument
- `render` is the last `Router.page` argument
- `setup` receives the page context plus generated controller instances
- `render` receives the page context, resolved setup data, and generated controller instances
- Prefer the generated page arguments or the app context hook; do not import `.proteum` files directly.
- Never use `api.fetch(...)` in page files
- Never import client service values from `@app`

## Typings

- Treat generated controller method typings as the source of truth
- Never cast controller methods, their parameters, or their return types
- If a page needs route data, return it from `setup` and consume it from `render`
