import fs from 'fs';
import path from 'path';

import type { TRow } from './layout';

export const proteumCommandNames = [
    'init',
    'dev',
    'refresh',
    'build',
    'typecheck',
    'lint',
    'check',
    'doctor',
    'explain',
    'trace',
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
    { title: 'Manifest and contracts', names: ['doctor', 'explain', 'trace'] },
    { title: 'Project scaffolding', names: ['init'] },
];

export const proteumCommands: Record<TProteumCommandName, TProteumCommandDoc> = {
    init: {
        name: 'init',
        category: 'Project scaffolding',
        summary: 'Scaffold a new Proteum project.',
        usage: 'proteum init',
        bestFor: 'Bootstrap a new app when the Proteum scaffold assets are installed in the current package.',
        examples: [{ description: 'Create a new app interactively', command: 'proteum init' }],
        notes: [
            'This command is still experimental.',
            'In source checkouts it requires `cli/skeleton` to exist.',
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
        usage: 'proteum explain [--all|--app|--conventions|--env|--services|--controllers|--routes|--layouts|--diagnostics] [--json]',
        bestFor:
            'Inspecting how source files became generated routes, controllers, layouts, services, and diagnostics without reading compiler internals.',
        examples: [
            { description: 'Show the default human summary', command: 'proteum explain' },
            {
                description: 'Inspect generated routes and controllers together',
                command: 'proteum explain --routes --controllers',
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
};

export const isLikelyProteumAppRoot = (workdir: string) =>
    fs.existsSync(path.join(workdir, 'package.json')) &&
    fs.existsSync(path.join(workdir, 'identity.yaml')) &&
    fs.existsSync(path.join(workdir, 'client')) &&
    fs.existsSync(path.join(workdir, 'server'));

export const getInitAvailabilityNote = (initAvailable: boolean) =>
    initAvailable
        ? 'Scaffold assets are installed in this checkout.'
        : 'This checkout does not include `cli/skeleton`, so `proteum init` is unavailable until the scaffold assets are restored.';

export const createClipanionUsage = (command: TProteumCommandDoc) => ({
    category: command.category,
    description: command.summary,
    details: [
        `Best for: ${command.bestFor}`,
        ...(command.notes && command.notes.length > 0 ? [`Notes:\n${command.notes.map((note) => `- ${note}`).join('\n')}`] : []),
    ].join('\n\n'),
    examples: command.examples.map((example) => [example.description, example.command] as [string, string]),
});
