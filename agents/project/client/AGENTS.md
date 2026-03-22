# Frontend

UI components are defined in `/client/pages` and `/client/components`.

## Stack

- Typescript strict
- Preact with SSR
- Follow the UI stack already used in the touched area.
- Many Proteum apps use Tailwind and `@/client/components/Motion`, but those are app conventions, not framework guarantees.
- When the project already exposes Shadcn components or `client/components/ui/**` primitives derived from them, prefer those components for standard UI instead of rebuilding the same primitives locally.

Don't add `React` imports just for JSX.
Use `React` only when a React or Preact API is actually needed.
Don't use `React.useCallback` unless strictly necessary or already common in the touched area.

## Communicate with the server

### Pages

Pages use `Router.page(...)`.

Use `Router.page(path, render)` when there is no SSR setup.

Use `Router.page(path, setup, render)` when the page needs SSR config or SSR data:

```typescript
Router.page('/dashboard/example', ({ Feature }) => ({
    _auth: 'USER',
    dataKey: Feature.loadExample(),
}), ({ dataKey }) => <Page data={dataKey} />);
```

- Keep the route registration compact instead of exploding the whole call into a staircase layout.
- `setup` returns one flat object
- keys like `_auth`, `_layout`, `_priority` are route config
- all other keys are SSR data fetchers
- never use `api.fetch(...)` in page files

### Components and hooks

Components and hooks access controllers through the app client context hook, typically `useContext()` from `@/client/context`:

```typescript
const { Auth, Domains } = useContext();
```

Then call controller methods directly:

```typescript
Auth.signUp(data).then((result) => {
    ...
});
```

### Async calls

- Prefer direct controller calls from the context or page render args
- Follow the controller naming and hierarchy already used in the touched feature instead of inventing a new one
- The thrown errors will automatically be displayed to the user, so don't silence them
- Never depend on legacy `@app` imports on the client

## Errors handling

Errors caught from controller calls should never be silenced.
If a catch is needed, rethrow or surface the failure clearly.

## Design

- Follow the existing design language of the app or feature area.
- Keep layouts responsive and accessible.
- Add motion only when the area already uses it or when it materially improves UX.
- Reuse Shadcn-based shared primitives first for common controls like buttons, inputs, dialogs, dropdowns, tabs, tables, and forms when they cover the requirement.
- Create custom UI primitives only when the existing Shadcn layer cannot express the interaction or visual requirement cleanly.

## Rules

- Don't add `React` imports unless the file actually uses a React or Preact API.
- Don't use any component from `@client/components` unless the codebase already does in that area, except for established shared primitives such as the project's Shadcn-based `client/components/ui/**` layer
- To create a link / button, always use the `Link` component when the codebase expects navigation links

## Keep the code organized

- Split big components (more than 1000 lines) into smaller components
- Always use one component per file
- Every time possible, load data and define action handlers in the directly concerned component instead of passing everything from the parent

## Split the page by sections via comments

Use:

```typescript
/*----------------------------------
- SECTION NAME
----------------------------------*/
```

File sections:
- DEPENDENCIES
- TYPES
- COMPONENT / PAGE

Component / page sections:
- INIT
- ACTIONS
- RENDER
