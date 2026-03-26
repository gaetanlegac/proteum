## Dev Commands

Proteum supports a dev-only internal command surface for testing, debugging, and one-off server-side execution that should not be exposed as a normal controller or route.

### Source Contract

- command files live under `./commands/**/*.ts`
- each file default-exports a class extending `Commands` from `@server/app/commands`
- every method with a body becomes a runnable command
- the command path is `file/path/methodName`
- `export const commandPath = 'Custom/path'` can override the file-derived base path

Example:

```ts
import { Commands } from '@server/app/commands';

export default class DiagnosticsCommands extends Commands {
  public async ping() {
    return {
      app: this.app.identity.identifier,
      env: this.app.env.profile,
    };
  }
}
```

The example above is available as `diagnostics/ping`.

When `./commands` exists, Proteum also creates `./commands/tsconfig.json` plus a generated command typing surface under `.proteum/server/commands.d.ts`.

- command files inherit the server alias project
- `extends Commands` works without importing your app class
- `@/server/index` remains available inside `/commands` as a generated command-only app type alias

### CLI

Run a command locally:

```bash
proteum command proteum/diagnostics/ping
```

Local mode does this:

1. refreshes `.proteum` artifacts
2. picks a temporary local port
3. builds the dev server output
4. starts a temporary local dev server
5. runs the command through the dev-only command endpoint
6. prints the result and exits

Run a command against an existing dev instance:

```bash
proteum command proteum/diagnostics/ping --port 3101
proteum command proteum/diagnostics/ping --url http://127.0.0.1:3101
```

Use `--port` or `--url` when you want to reuse an existing `proteum dev` instance instead of building and starting a temporary local one.

### Profiler

In `proteum dev`, the bottom profiler exposes a `Commands` tab.

- it lists every generated command path
- it shows the backing class, method, scope, and source location
- clicking `Run now` executes the command through the running dev server
- the last result or error stays attached to that command row in the panel

The profiler also exposes the shared diagnostics surfaces for humans:

- `Explain` renders the same manifest-backed data as `proteum explain`
- `Doctor` renders the same manifest diagnostics as `proteum doctor`

For the shared diagnostics contract and the corresponding dev HTTP endpoints, see [diagnostics.md](diagnostics.md).

### HTTP Endpoints

The CLI remote mode and the profiler use the same dev-only endpoints:

- `GET /__proteum/commands`
- `POST /__proteum/commands/run`

These endpoints exist only in dev mode and are not available in production.

### Built-In Command

Proteum ships one framework command by default:

- `proteum/diagnostics/ping`

It returns the current app identifier, active env profile, and discovered root services so every dev app has a real command surface available immediately.
