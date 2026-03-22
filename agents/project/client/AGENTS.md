# Frontend designing

UI components are defined in `/client/pages` and `/client/components`.

## Stack

- Typescript strict
- Preact with SSR
- Base UI
- `@/client/components/Motion`
- Tailwind CSS 4

Don't use React.useCallback unless strictly necessary.

## Communicate with the server

### Pages

Pages use `Router.page(...)`.

Use `Router.page(path, render)` when there is no SSR setup.

Use `Router.page(path, setup, render)` when the page needs SSR config or SSR data:

```typescript
Router.page('/dashboard/example', ({ Missions }) => ({
    _auth: 'USER',
    missions: Missions.Get(),
}), ({ request, missions, Missions }) => {
    return <Page missions={missions} />;
});
```

- `setup` returns one flat object
- keys like `_auth`, `_layout`, `_priority` are route config
- all other keys are SSR data fetchers
- never use `api.fetch(...)` in page files

### Components and hooks

Components and hooks access controllers through `useContext()`:

```typescript
const { Auth, Domains } = useContext();
```

Then call controller methods directly:

```typescript
Auth.Signup(data).then((result) => {
    ...
});
```

### Async calls

- Prefer direct controller calls from the context or page render args
- The thrown errors will automatically be displayed to the user, so don't silent them
- Never depend on legacy `@app` imports on the client

## Errors handling

Errors catched from controller calls should never be silented.
If a catch is needed, rethrow or surface the failure clearly.

## Design

- Beautiful, modern, minimalist and intuitive design
- Responsive layout
- Enhance the UX with meaningful animations

## Rules

- Always import React in react files (`.tsx`)
- Don't use any component from `@client/components` unless the codebase already does in that area
- To create a link / button, always use the `Link` component when the codebase expects navigation links

## Keep the code organized

- Split big components (more than 1000 lines) into smaller components
- Always use one component per file
- Everytime possible, load data and define action handlers in the directly concerned component instead of passing everything from the parent

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
