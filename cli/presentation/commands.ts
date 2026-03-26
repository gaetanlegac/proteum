import fs from 'fs';
import path from 'path';

import type { TRow } from './layout';

export const proteumCommandNames = [
    'init',
    'create',
    'dev',
    'refresh',
    'build',
    'typecheck',
    'lint',
    'check',
    'doctor',
    'explain',
    'trace',
    'command',
    'session',
] as const;

export type TProteumCommandName = (typeof proteumCommandNames)[number];

type TProteumCommandExample = {
    description: string;
    command: string;
};

type TProteumCommandStatus = 'stable' | 'experimental';

export type TProteumCommandDoc = {
    name: TProteumCommandName;
    category: string;
    summary: string;
    usage: string;
    bestFor: string;
    examples: TProteumCommandExample[];
    notes?: string[];
    status?: TProteumCommandStatus;
};

export const proteumRecommendedFlow: TRow[] = [
    { label: '1. proteum dev', value: 'Start the compiler, SSR server, and hot reload loop.' },
    { label: '2. proteum refresh', value: 'Regenerate .proteum contracts and typings after source or framework changes.' },
    { label: '3. proteum check', value: 'Refresh, typecheck, and lint before you commit or push.' },
    { label: '4. proteum build --prod', value: 'Produce the production server and client bundles.' },
];

export const proteumCommandGroups: Array<{ title: string; names: TProteumCommandName[] }> = [
    { title: 'Daily workflow', names: ['dev', 'refresh', 'build'] },
    { title: 'Quality gates', names: ['typecheck', 'lint', 'check'] },
    { title: 'Manifest and contracts', names: ['doctor', 'explain', 'trace', 'command', 'session'] },
    { title: 'Project scaffolding', names: ['init', 'create'] },
];

export const proteumCommands: Record<TProteumCommandName, TProteumCommandDoc> = {
    init: {
        name: 'init',
        category: 'Project scaffolding',
        summary: 'Scaffold a new Proteum app with deterministic built-in templates.',
        usage: 'proteum init [directory] [--name <name>] [--identifier <identifier>] [--port <port>] [--install] [--dry-run] [--json]',
        bestFor: 'Bootstrapping a new app in a way that is explicit, machine-readable, and safe for LLM coding agents.',
        examples: [
            { description: 'Create a new app in ./my-app', command: 'proteum init my-app --name "My App"' },
            {
                description: 'Scaffold an app and install dependencies immediately',
                command: 'proteum init my-app --name "My App" --install',
            },
            {
                description: 'Emit scaffold details as JSON for an agent',
                command: 'proteum init my-app --name "My App" --json',
            },
            {
                description: 'Preview the full app scaffold without writing files',
                command: 'proteum init my-app --name "My App" --dry-run --json',
            },
        ],
        notes: [
            'When Proteum is invoked from a local framework checkout, init writes a file: dependency to that checkout by default.',
            'Use `--dry-run --json` when an agent needs a machine-readable app scaffold plan before writing files.',
            'Without `--install`, init only writes files and does not touch the network.',
        ],
        status: 'experimental',
    },
    create: {
        name: 'create',
        category: 'Project scaffolding',
        summary: 'Generate a page, controller, command, route, or root service inside a Proteum app.',
        usage: 'proteum create <page|controller|command|route|service> <target> [--route <url>] [--method <name>] [--http-method <verb>] [--dry-run] [--json]',
        bestFor: 'Fast deterministic scaffolding inside an existing Proteum app without inventing file layouts or boilerplate by hand.',
        examples: [
            { description: 'Create a new SSR page', command: 'proteum create page marketing/faq --route /faq' },
            { description: 'Create a new controller', command: 'proteum create controller Founder/projects --method list' },
            { description: 'Create a new command', command: 'proteum create command diagnostics --method ping' },
            { description: 'Preview a new route without writing files', command: 'proteum create route webhooks/stripe --dry-run --json' },
            { description: 'Create and register a new root service', command: 'proteum create service Conversion/Plans' },
        ],
        notes: [
            'Page scaffolds write `client/pages/**/index.tsx` and default the route path from the logical target path unless `--route` is provided.',
            'Service scaffolds create `server/services/**/index.ts`, `service.json`, a config export under `server/config/*.ts`, and then try to register the new root service in `server/index.ts`.',
            'Use `--dry-run --json` when an agent needs a machine-readable plan before writing files.',
        ],
        status: 'experimental',
    },
    dev: {
        name: 'dev',
        category: 'Daily workflow',
        summary: 'Start the local compiler, SSR server, and hot reload loop.',
        usage: 'proteum dev [--port <port>] [--cache|--no-cache]',
        bestFor:
            'Day-to-day app work. This is the main entrypoint used by the current reference apps during local development.',
        examples: [
            { description: 'Start the app on its configured router port', command: 'proteum dev' },
            { description: 'Run a second Proteum app on another port', command: 'proteum dev --port 3101' },
            {
                description: 'Disable the filesystem cache while debugging compiler state',
                command: 'proteum dev --no-cache',
            },
        ],
        notes: ['Legacy single-dash long options remain supported, for example `proteum dev -port 3001`.'],
        status: 'stable',
    },
    refresh: {
        name: 'refresh',
        category: 'Daily workflow',
        summary: 'Refresh generated Proteum typings and artifacts.',
        usage: 'proteum refresh',
        bestFor:
            'Force regeneration of the framework-owned `.proteum` output when routes, controllers, services, or framework generation rules changed.',
        examples: [
            { description: 'Refresh generated contracts after source edits', command: 'proteum refresh' },
        ],
        notes: ['Use this when you need deterministic regeneration without starting the full dev loop.'],
        status: 'stable',
    },
    build: {
        name: 'build',
        category: 'Daily workflow',
        summary: 'Build the application.',
        usage: 'proteum build [--prod] [--strict] [--cache] [--analyze] [--port <port>]',
        bestFor: 'CI, release builds, and local verification of the production server and client output.',
        examples: [
            { description: 'Run the normal production build', command: 'proteum build --prod' },
            {
                description: 'Refresh typings, typecheck, then build in strict mode',
                command: 'proteum build --prod --strict',
            },
            { description: 'Generate bundle analysis artifacts', command: 'proteum build --prod --analyze' },
            { description: 'Reuse the filesystem cache during builds', command: 'proteum build --prod --cache' },
        ],
        notes: [
            'Legacy positional booleans remain supported, for example `proteum build prod strict analyze`.',
            'Use `--strict` when the build must refresh generated typings and fail on any TypeScript error before compilation starts.',
            'The production output is emitted under `bin/`.',
        ],
        status: 'stable',
    },
    typecheck: {
        name: 'typecheck',
        category: 'Quality gates',
        summary: 'Run TypeScript typechecking for the application.',
        usage: 'proteum typecheck',
        bestFor: 'Fast verification that generated contracts and app code still satisfy the TypeScript surface.',
        examples: [
            { description: 'Typecheck every discovered client and server app tsconfig', command: 'proteum typecheck' },
        ],
        notes: ['Proteum refreshes generated typings before running TypeScript.'],
        status: 'stable',
    },
    lint: {
        name: 'lint',
        category: 'Quality gates',
        summary: 'Run ESLint for the application.',
        usage: 'proteum lint [--fix]',
        bestFor: 'Static code-quality validation across the current app root.',
        examples: [
            { description: 'Run ESLint in check mode', command: 'proteum lint' },
            { description: 'Apply fixable lint changes', command: 'proteum lint --fix' },
        ],
        notes: ['Legacy positional usage such as `proteum lint fix` remains supported.'],
        status: 'stable',
    },
    check: {
        name: 'check',
        category: 'Quality gates',
        summary: 'Refresh typings, typecheck, then lint the application.',
        usage: 'proteum check',
        bestFor: 'One command before commits, pushes, or CI when you want the standard local validation path.',
        examples: [{ description: 'Run the full default validation pipeline', command: 'proteum check' }],
        notes: ['This command executes refresh, typecheck, then lint in that order.'],
        status: 'stable',
    },
    doctor: {
        name: 'doctor',
        category: 'Manifest and contracts',
        summary: 'Inspect the generated Proteum manifest diagnostics.',
        usage: 'proteum doctor [--json] [--strict]',
        bestFor:
            'Auditing manifest warnings and errors, especially in CI or when route/controller generation behaves unexpectedly.',
        examples: [
            { description: 'Print a human-readable diagnostic summary', command: 'proteum doctor' },
            { description: 'Fail if any diagnostics exist', command: 'proteum doctor --strict' },
            { description: 'Emit machine-readable diagnostics', command: 'proteum doctor --json' },
        ],
        notes: ['`--strict` is intended for CI and pre-release verification.'],
        status: 'stable',
    },
    explain: {
        name: 'explain',
        category: 'Manifest and contracts',
        summary: 'Explain the generated Proteum manifest.',
        usage: 'proteum explain [--all|--app|--conventions|--env|--services|--controllers|--commands|--routes|--layouts|--diagnostics] [--json]',
        bestFor:
            'Inspecting how source files became generated routes, controllers, commands, layouts, services, and diagnostics without reading compiler internals.',
        examples: [
            { description: 'Show the default human summary', command: 'proteum explain' },
            {
                description: 'Inspect generated routes, controllers, and commands together',
                command: 'proteum explain --routes --controllers --commands',
            },
            { description: 'Emit the selected manifest sections as JSON', command: 'proteum explain --routes --json' },
        ],
        notes: ['Legacy positional section selection remains supported, for example `proteum explain routes services`.'],
        status: 'stable',
    },
    trace: {
        name: 'trace',
        category: 'Manifest and contracts',
        summary: 'Inspect live in-memory request traces from a running Proteum dev server.',
        usage: 'proteum trace [latest|show <requestId>|requests|arm|export <requestId>] [--port <port>|--url <baseUrl>] [--json]',
        bestFor:
            'Debugging route resolution, context creation, SSR payloads, renders, and runtime errors without attaching a debugger.',
        examples: [
            { description: 'Show the latest request trace', command: 'proteum trace latest' },
            { description: 'List recent trace summaries', command: 'proteum trace requests' },
            { description: 'Arm the next request for deep capture', command: 'proteum trace arm --capture deep' },
            { description: 'Export a request trace to disk', command: 'proteum trace export <requestId>' },
            { description: 'Target a custom dev base URL directly', command: 'proteum trace latest --url http://127.0.0.1:3010' },
        ],
        notes: [
            'This command talks to the running app over the dev-only `__proteum/trace` HTTP endpoints.',
            'Traces are stored in a bounded in-memory buffer with payload summarization and sensitive-field redaction.',
            'Use `--port` when the app is not running on the router port declared in `PORT`, or `--url` when the host itself is non-standard.',
        ],
        status: 'experimental',
    },
    command: {
        name: 'command',
        category: 'Manifest and contracts',
        summary: 'Run a dev-only app command from /commands or against an existing dev instance.',
        usage: 'proteum command <path> [--port <port>|--url <baseUrl>] [--json]',
        bestFor:
            'Internal testing, debugging, and one-off service execution that should not be exposed as a normal controller or route.',
        examples: [
            {
                description: 'Run a local command through a temporary bundled dev server',
                command: 'proteum command proteum/diagnostics/ping',
            },
            {
                description: 'Run a command against an existing dev server',
                command: 'proteum command proteum/diagnostics/ping --port 3101',
            },
            {
                description: 'Emit the command execution as JSON',
                command: 'proteum command proteum/diagnostics/ping --json',
            },
        ],
        notes: [
            'Commands live under `./commands/**/*.ts` and default-export a class that extends `{ Commands }` from `@server/app/commands`.',
            'Methods are addressed by file path plus method name, mirroring controller path generation.',
            'Proteum creates `./commands/tsconfig.json` and `.proteum/server/commands.d.ts` so `/commands` gets a command-specific alias/type project.',
            'Prefer `extends Commands` directly inside `/commands`; importing the app class is still supported through a generated command-only `@/server/index` type alias.',
            'Without `--port` or `--url`, Proteum refreshes generated artifacts, builds the dev output, starts a temporary local dev server, runs the command, and exits.',
            'With `--port` or `--url`, Proteum talks to the running app over the dev-only `__proteum/commands` HTTP endpoints.',
        ],
        status: 'experimental',
    },
    session: {
        name: 'session',
        category: 'Manifest and contracts',
        summary: 'Mint a dev-only auth session token and cookie payload for a known user.',
        usage: 'proteum session <email> [--role <role>] [--port <port>|--url <baseUrl>] [--json]',
        bestFor:
            'Starting browser or API automation from an authenticated state without driving the login UI, while still using the app-configured auth service.',
        examples: [
            {
                description: 'Mint an admin session for a running dev server',
                command: 'proteum session admin@example.com --role ADMIN --port 3101',
            },
            {
                description: 'Mint a GOD session for unique.domains and print machine-readable cookie data',
                command: 'proteum session god@example.com --role GOD --json',
            },
        ],
        notes: [
            'Sessions are available only in dev mode and use the auth service registered on the current app router.',
            'You must provide the target user email explicitly; Proteum does not guess your admin account universally across apps.',
            'The command returns a token plus Playwright-ready cookie JSON so agents can inject the session into a browser context directly.',
            'Without `--port` or `--url`, Proteum refreshes generated artifacts, builds the dev output, starts a temporary local dev server, creates the session, prints the payload, and exits.',
        ],
        status: 'experimental',
    },
};

export const isLikelyProteumAppRoot = (workdir: string) =>
    fs.existsSync(path.join(workdir, 'package.json')) &&
    fs.existsSync(path.join(workdir, 'identity.yaml')) &&
    fs.existsSync(path.join(workdir, 'client')) &&
    fs.existsSync(path.join(workdir, 'server'));

export const getInitAvailabilityNote = (initAvailable: boolean) =>
    initAvailable
        ? 'Init is built into the CLI and does not depend on external scaffold assets.'
        : 'Init scaffolding is currently unavailable in this checkout.';

export const createClipanionUsage = (command: TProteumCommandDoc) => ({
    category: command.category,
    description: command.summary,
    details: [
        `Best for: ${command.bestFor}`,
        ...(command.notes && command.notes.length > 0 ? [`Notes:\n${command.notes.map((note) => `- ${note}`).join('\n')}`] : []),
    ].join('\n\n'),
    examples: command.examples.map((example) => [example.description, example.command] as [string, string]),
});
