/*----------------------------------
- DEPENDANCES
----------------------------------*/

// npm
import readline, { Key } from 'readline';
import { logVerbose } from '../runtime/verbose';

/*----------------------------------
- TYPES
----------------------------------*/

type TKeyboardCommand = { remove?: boolean; run: (str: string, chunk: string, key: Key) => void | Promise<void> };

/*----------------------------------
- METHODS
----------------------------------*/
class KeyboardCommands {
    private commands: { [input: string]: TKeyboardCommand } = {};

    public constructor() {
        this.listen();
    }

    private listen() {
        if (!process.stdin) return;

        readline.emitKeypressEvents(process.stdin);

        if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== 'function') {
            logVerbose('Keyboard shortcuts disabled because stdin is not an interactive TTY.');
            return;
        }

        process.stdin.setRawMode(true);
        process.stdin.on('keypress', async (chunk: string, key: Key) => {
            let str = key.name;
            if (!str) return;
            if (str === 'return') str = 'enter';

            if (key.ctrl) str = 'ctrl+' + str;
            if (key.shift) str = 'shift+' + str;
            if (key.meta) str = 'meta+' + str;

            const kCommand = this.commands[str] || this.commands.fallback;

            try {
                if (kCommand) {
                    await kCommand.run(str, chunk, key);

                    if (kCommand.remove) delete this.commands[str];
                }
            } catch (error) {
                console.error(error);
            }

            if (str === 'ctrl+c' && !kCommand) {
                logVerbose(`Exiting ...`);
                process.exit(0);
            }
        });
    }

    public input(str: string, run: TKeyboardCommand['run'], options: Omit<TKeyboardCommand, 'run'> = {}) {
        this.commands[str] = { run, ...options };
    }

    public waitForInput(str: string): Promise<void> {
        return new Promise((resolve) => {
            this.commands[str] = { run: () => resolve(), remove: true };
        });
    }
}

export default new KeyboardCommands();
