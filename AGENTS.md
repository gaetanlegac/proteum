# Proteum Framework

## Vision

Proteum aims to become the first SSR / SEO / TypeScript framework built primarily for non-human developers and AI agents.

The framework should maximize LLM efficiency, correctness, determinism, and performance when building Proteum-based projects.

When tradeoffs exist, prioritize framework decisions in this order:

1. Reduce shipped client bundle size and unnecessary runtime code.
2. Increase build-time, server-time, and browser-time performance.
3. Improve SEO output and LLM-friendly, crawlable, semantic HTML.
4. Preserve explicit, typed, machine-readable contracts for agents.

When working on Proteum itself, optimize for agent ergonomics first:

- Prefer explicit, typed, machine-readable contracts over implicit runtime magic, hidden conventions, ambient globals, or tribal knowledge.
- Enforce strong, consistent TypeScript typings across the whole project. Do not introduce `any` or `unknown`.
- Make routes, data loading, server actions / controllers, services, SEO metadata, sitemap generation, static generation, and environment contracts easy to discover, inspect, and explain.
- Treat SSR and SEO as first-class framework primitives, not app-level patchwork.
- Prefer server-first designs that avoid shipping client JavaScript unless it is required for user-facing behavior.
- Favor small, single-purpose files and modules that reduce context load and make edits easier for agents to scope safely.
- Generated code should improve traceability and type safety, not obscure behavior. It should be deterministic, auditable, and easy for agents to map back to source files.
- Prefer inference from the explicit application class in `server/index.ts` whenever possible. Treat `server/index.ts` as the canonical type root for application services, router services, router context, and models instead of duplicating manual type declarations.
- Prefer exact end-to-end contracts for inputs, outputs, errors, side effects, and caching behavior.
- Prefer framework features that make impact analysis, verification, and debugging easier for agents.
- Prefer output that is fast to render, easy to crawl, semantically rich, and easy for LLMs to parse reliably.
- Avoid introducing abstractions that require broad codebase memory to use correctly.

When proposing or implementing a core change, evaluate it against this question:

- Does this make Proteum easier for an AI agent to understand, modify, verify, and operate with high confidence?

# Workflow

- Everytime I input error messages without any instructions, don't implement fixes.
Instead, ivestigate the potential causes of the errors, and for each: 
  1. Evaluate / quantify the probabiliies 
  2. Give why and 
  3. Suggest how to fix it
- When you have finished your work, summarize in one top-level short sentence ALL the changes you made since the beginning of the WHOLE conversation. Output as "Commit message". Max 90 characters.

## Framework Workflow

When changing Proteum itself, always ground the work in the real apps that use it.

- Treat these two projects as the reference surface for current Proteum usage and needs:
  - `/Users/gaetan/Desktop/Projets/crosspath/platform`
  - `/Users/gaetan/Desktop/Projets/unique.domains/website`
- Before proposing a framework change, inspect how both apps currently use the feature, runtime, API, compiler behavior, or generated files involved.
- Prefer removing framework magic when the same result can be expressed with explicit runtime contracts, generated code, or typed context.
- If a webpack plugin, Babel plugin, alias, helper, runtime service, or npm package is not meaningfully used by both reference apps, challenge its existence and prefer deleting it.

## Current Proteum Direction

Future changes should preserve and extend the current explicit model instead of reintroducing runtime magic.

- Strong typings are mandatory across the whole project. Do not use `any` or `unknown`; keep types explicit, precise, and consistent.
- Prefer deriving types from the explicit application class in `server/index.ts` instead of recreating them manually in feature code, helpers, or generated output.
- Server route entrypoints live in `server/controllers/**/*.ts` files.
- Controllers extend `Controller` and read request-scoped values from `this.request`.
- Controllers validate request input via `this.input(schema)` inside the method body. Do not use decorators for validation metadata.
- `server/config/*.ts` should export plain typed config constants with `Services.config(ServiceClass, { ... })`, for example `export const missionsConfig = Services.config(Missions, { ... })`.
- `server/index.ts` should default-export the app `Application` subclass and instantiate root services as public fields via `new ServiceClass(this, config, this)`.
- Normal services extend `Service` and should use `this.services`, `this.models`, and `this.app` instead of implicit globals or magic imports.
- App services should be inferred from the explicit `server/index.ts` application graph and the config passed into each constructor, not hand-maintained parallel interfaces.
- Router services and router/request context values such as `user`, `auth`, and similar request-scoped contracts should come from inferred request and app types, not ad hoc casts.
- Models should be inferred from the app/model registry rooted at `server/index.ts` and exposed through generated app types, not from duplicated hand-written model maps.
- Controllers should own auth, input parsing, and request concerns, then pass explicit typed values into services.
- Do not reintroduce runtime server imports or globals such as `@request`, `@models`, or `@app`.
- Client pages use `Router.page(path, render)` or `Router.page(path, setup, render)`.
- SSR data loading belongs in the `setup` function returned object, not in `api.fetch(...)`.
- Client-side controller access should come from the generated controller tree and client context, not from fake runtime imports.
- When referencing an app service, a router service, or a model, expose it in the current block scope first by destructuring from `this.request`, `this.app`, or `this.app.Models.client`, then call methods on that local binding. The service, router value, or model should be the first element of the callee chain.

## Solution Proposals

When presenting a framework solution, make it easy to judge against the real apps.

- Start from the actual mismatch or risk seen in the apps, not from abstract framework theory.
- Show the target API with concrete client and server usage examples that match current Proteum conventions.
- Distinguish:
  - the ideal end-state API
  - any transitional migration rule or guardrail
- Call out what becomes impossible or safer after the change.
- If the change affects generated code, explain what source files drive generation and what artifacts are produced.
- If the change removes older behavior, explicitly name what is being deleted and why it is obsolete.

## Implementation Rules

- Keep framework changes aligned with the explicit controller/page architecture already adopted in the reference apps.
- Prefer deleting client-side code, dependencies, and emitted assets when the same capability can stay on the server or be generated statically.
- Prefer deleting obsolete branches, compatibility layers, plugins, and dependencies over keeping dead paths around.
- Prefer compiler logic that is deterministic, auditable, and easy for another agent to trace from source to generated output.
- Prefer local destructuring that exposes typed app services, router services, router context values, and models in the current block scope before use, instead of chaining through `this.request`, `this.app`, or `this.app.Models.client` at each call site.
- Reject changes that increase bundle size, runtime cost, or crawlability risk unless the benefit is concrete and validated in both reference apps.
- When removing old behavior, also remove the related packages, config flags, typings, docs, and dead helper files in the same pass when safe.
- If a core change breaks one of the reference apps, keep iterating until the framework and the affected app usage are both corrected.

## Real-World Validation

Do not stop at static analysis or isolated core compilation when the change affects runtime behavior.

- Validate framework changes against the two reference apps whenever the change touches routing, controllers, generated code, SSR, client runtime, services, webpack, Babel, or emitted assets.
- Preferred runtime validation:
  - run `npx proteum dev --no-cache -port 3xxx` in both apps on explicit ports
  - open the real pages with Playwright
  - inspect browser console errors and warnings
  - inspect server startup and runtime errors
- Build-only checks are not sufficient for runtime/compiler changes. Use them as supplements, not as the final proof.
- Keep fixing regressions exposed by the dev-server and browser pass until both apps boot and the browser console shows no new real errors.
- Treat external/local-environment warnings separately from framework regressions, and say clearly when something is unrelated to the current change.
