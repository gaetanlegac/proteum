import fs from "fs-extra";

const files: Record<string, string> = {
  "/Users/gaetan/Desktop/Projets/framework/agents/codex/AGENTS.md": `# Architecture

This is a full stack monolith project using Typescript, NodeJS, Preact, and Proteum.

\`/client\`: frontend
    \`/assets\`: CSS, images and other frontend assets
    \`/components\`: reusable components
    \`/pages\`: page route files and page-local UI
    \`/hooks\`
\`/common\`: shared functions, constants and typings
\`/server\`: backend
    \`/config\`: service configuration
    \`/services\`: backend services and controllers
    \`/routes\`: explicit non-controller routes
    \`/lib\`: helper functions
\`/tests\`

# Coding style

- **The code should be at the highest level of industry, as the product will be used by GAFAMs and will be maintained by a team of 10 developers.**
- Write clean, consistent, readable code with a tab size of 4.
- Keep functions and methods short. Everytime possible, create **reusable** functions and components instead of repeating.

# Files organization

- Always keep one class / react component per file
- Prefer a deep tree structure that groups files by business concern instead of long file names
- The default \`*.ts\` / \`*.tsx\` file is the browser implementation; use \`*.ssr.ts\` / \`*.ssr.tsx\` only for SSR-safe fallbacks

## Centralize feature catalogs (Single Source of Truth)

When implementing a feature that relies on a **curated list of items**, keep **one canonical catalog/registry file** and make all other code import it.

## Runtime access rules

- \`@models/types\`: Prisma typings only. Can be imported anywhere.
- Never use runtime value imports from \`@request\` or \`@models\`.
- Never expose request-scoped state through imports.

## Client runtime access

- Page route files use \`Router.page(...)\`.
- \`Router.page(path, render)\` for pages without SSR setup.
- \`Router.page(path, setup, render)\` for pages with SSR config/data.
- \`setup\` receives the normal page context plus the generated controller tree spread into it.
- \`render\` receives the normal page context plus the resolved setup data and the same controller tree spread into it.
- Components and hooks use \`useContext()\` to access controller instances and client runtime services.

## Server runtime access

- Normal business logic lives in \`/server/services/**/index.ts\` classes that extend \`Service\`.
- Route entrypoints live in \`*.controller.ts\` classes that extend \`Controller\`.
- Only controller files are indexed as callable API endpoints.
- Controller methods validate input with \`this.input(schema)\` and access request scope through \`this.request\`.
- Service classes access other services via \`this.services\` and prisma models via \`this.models\`.
- Never use request-scoped state directly inside normal service methods.

# Agent behavior

**Make sure the code you generate integrates perfectly with the current codebase by avoiding repetition and centralizing each purpose.**

## Typings

- Fix typing issues only on the code you wrote.
- Never force cast with \`unknown\` or \`any\`. If you find no other solutions, tell me in the output.

## Workflow

- Everytime I input error messages without any instructions, don't implement fixes.
Instead, ivestigate the potential causes of the errors, and for each:
    1. Evaluate / quantify the probabiliies
    2. Give why and
    3. Suggest how to fix it
- When you have finished your work, summarize in one top-level short sentence the changes you made since the beginning of the conversation. Output as "Commit message".

## Never edit the following files

- Prisma files (except schema.prisma)
- tsconfigs
- env
- Any file / folder that is a symbolic link

If you need to edit them, just suggest it in the chat.

## Don't run any of these commands

\`\`\`
git restore
git reset
prisma *
And any git command in the write mode.
\`\`\`

# Copy and UX

Before making UX/copy decisions, read \`docs/PERSONAS.md\`, \`docs/PRODUCT.md\`, \`docs/MARKETING.md\`.
`,
  "/Users/gaetan/Desktop/Projets/framework/agents/codex/client/AGENTS.md": `# Frontend designing

UI components are defined in \`/client/pages\` and \`/client/components\`.

## Stack

- Typescript strict
- Preact with SSR
- Base UI
- \`@/client/components/Motion\`
- Tailwind CSS 4

Don't use React.useCallback unless strictly necessary.

## Communicate with the server

### Pages

Pages use \`Router.page(...)\`.

Use \`Router.page(path, render)\` when there is no SSR setup.

Use \`Router.page(path, setup, render)\` when the page needs SSR config or SSR data:

\`\`\`typescript
Router.page('/dashboard/example', ({ Missions }) => ({
    _auth: 'USER',
    missions: Missions.Get(),
}), ({ request, missions, Missions }) => {
    return <Page missions={missions} />;
});
\`\`\`

- \`setup\` returns one flat object
- keys like \`_auth\`, \`_layout\`, \`_priority\` are route config
- all other keys are SSR data fetchers
- never use \`api.fetch(...)\` in page files

### Components and hooks

Components and hooks access controllers through \`useContext()\`:

\`\`\`typescript
const { Auth, Domains } = useContext();
\`\`\`

Then call controller methods directly:

\`\`\`typescript
Auth.Signup(data).then((result) => {
    ...
});
\`\`\`

### Async calls

- Prefer direct controller calls from the context or page render args
- The thrown errors will automatically be displayed to the user, so don't silent them
- Never depend on legacy \`@app\` imports on the client

## Errors handling

Errors catched from controller calls should never be silented.
If a catch is needed, rethrow or surface the failure clearly.

## Design

- Beautiful, modern, minimalist and intuitive design
- Responsive layout
- Enhance the UX with meaningful animations

## Rules

- Always import React in react files (\`.tsx\`)
- Don't use any component from \`@client/components\` unless the codebase already does in that area
- To create a link / button, always use the \`Link\` component when the codebase expects navigation links

## Keep the code organized

- Split big components (more than 1000 lines) into smaller components
- Always use one component per file
- Everytime possible, load data and define action handlers in the directly concerned component instead of passing everything from the parent

## Split the page by sections via comments

Use:

\`\`\`typescript
/*----------------------------------
- SECTION NAME
----------------------------------*/
\`\`\`

File sections:
- DEPENDENCIES
- TYPES
- COMPONENT / PAGE

Component / page sections:
- INIT
- ACTIONS
- RENDER
`,
  "/Users/gaetan/Desktop/Projets/framework/agents/codex/client/pages/AGENTS.md": `# Page files

Page files are located in \`/client/pages/**/*.tsx\`.

## Router.page contract

Use one of these forms:

\`\`\`typescript
Router.page('/path', ({ request, ServiceName }) => {
    return <Page />;
});
\`\`\`

\`\`\`typescript
Router.page('/path', ({ ServiceName }) => ({
    _auth: 'USER',
    dataKey: ServiceName.MethodName({ param1: 'value' }),
}), ({ request, dataKey, ServiceName }) => {
    return <Page data={dataKey} />;
});
\`\`\`

- \`setup\` is the second \`Router.page\` argument
- \`render\` is the last \`Router.page\` argument
- \`setup\` receives the page context plus generated controller instances
- \`render\` receives the page context, resolved setup data, and generated controller instances
- Never use \`api.fetch(...)\` in page files
- Never import client service values from \`@app\`

## Typings

- Treat generated controller method typings as the source of truth
- Never cast controller methods, their parameters, or their return types
- If a page needs route data, return it from \`setup\` and consume it from \`render\`
`,
  "/Users/gaetan/Desktop/Projets/framework/agents/codex/server/services/AGENTS.md": `# Server Services

Stack:
- Typescript with strict mode
- NodeJS
- Prisma 7 ORM

## 1. Create the service file in \`/server/services/<service name>/index.ts\`

Template:

\`\`\`typescript
/*----------------------------------
- DEPENDANCE
----------------------------------*/

// Core libs
import Service from '@server/app/service';

/*----------------------------------
- TYPES
----------------------------------*/

export type Config = <ServiceConfig>;

/*----------------------------------
- SERVICE
----------------------------------*/

export default class ServiceName extends Service<Config, {}, CrossPath, CrossPath> {

    public async MethodName(data: { param1: string }) {
        const { OtherService } = this.services;

        return OtherService.OtherMethod(data);
    }
}
\`\`\`

\`<ServiceConfig>\` is an object containing api keys and other variables we can adjust in the future.

## 2. Create the controller file in \`/server/services/<service name>/<ServiceName>.controller.ts\`

Template:

\`\`\`typescript
import Controller, { schema } from '@server/app/controller';
import type { TMethodInput } from './index';

const MethodInput = schema.object({
    param1: schema.string(),
});

export default class ServiceNameController extends Controller {

    public async MethodName() {
        const data = this.input(MethodInput);
        const { ServiceName } = this.services;
        const { auth, request, user } = this.request;

        return ServiceName.MethodName(data);
    }
}
\`\`\`

Rules:
- Only \`*.controller.ts\` files are indexed as callable API endpoints
- Route path is derived from the controller file path and the method name
- \`this.input(schema)\` is the only validation entrypoint
- Call \`this.input(...)\` at most once per controller method
- Request-scoped state exists only on \`this.request\`

## 3. Create the service metas file in \`/server/services/<service name>/service.json\`

\`\`\`json
{
    "id": "CrossPath/ServiceName",
    "name": "CrossPathServiceName",
    "parent": "app",
    "dependences": []
}
\`\`\`

## 4. Register the service in \`/server/config/<app>.ts\`

\`\`\`typescript
app.setup('ServiceName', 'CrossPath/ServiceName', <ServiceConfig>);
\`\`\`

## 5. Keep classes clean

If the class grows too large, split business concerns into subservices.

## 6. Use request-aware features only in controllers

Use:

\`\`\`typescript
const { auth, request, user, response } = this.request;
\`\`\`

- Never import runtime request state from \`@request\`
- Never access request-scoped state inside normal service methods unless the controller passes the minimal values explicitly

## 7. Fetch and return data from the database

Use runtime models through \`this.models\`:

\`\`\`typescript
const users = await this.models.user.findMany({
    select: {
        id: true,
    },
});
\`\`\`

Use prisma typings through \`@models/types\` only:

\`\`\`typescript
import type * as Models from '@models/types';
\`\`\`

Rules:
- Never edit prisma files, except the schema
- Never use runtime \`@models\` imports
- In all queries and joins, always specify what fields to select

## DTO and typing rules

- Prefer inferred return types:
\`export type TResult = Awaited<ReturnType<MyService["MethodName"]>>;\`
- Never create manual DTO types when the exact return type can be inferred

## Errors handling

Unhandled errors are passed to the \`bug\` app hook.
Never silent caught errors. Throw \`Anomaly\` with enough detail and the original error when needed.
`,
  "/Users/gaetan/Desktop/Projets/framework/agents/codex/server/routes/AGENTS.md": `# Server routes

Use \`/server/routes/**\` only for explicit custom routes that should not be generated from controllers.

- Callable app APIs belong in \`*.controller.ts\` files under \`/server/services\`
- \`/server/routes/**\` is for manual \`Router.get/post/...\` routes, redirects, resources, OAuth callbacks, etc.

## Generate absolute urls

The absolute urls are generated via \`Router.url()\`:

\`const absoluteUrl = Router.url('/relative/path')\`
`,
  "/Users/gaetan/Desktop/Projets/framework/agents/codex/tests/AGENTS.md": `# Codex guidance for writing E2E tests

- Understand the typical user flow and the main feature branches
- Favor as many tests as possible to cover real usage
- Always locate elements via their \`data-testid\` attribute
- Add \`data-testid\` where needed
- Keep test files clean, organized and structured
- Test the current controller/page runtime model, not legacy \`@Route\` or \`api.fetch\` behavior
`,
};

for (const [filepath, content] of Object.entries(files)) {
  fs.outputFileSync(filepath, content);
  console.log(`[update-codex-agents] wrote ${filepath}`);
}
