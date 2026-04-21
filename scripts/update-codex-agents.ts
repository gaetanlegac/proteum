/*----------------------------------
- DEPENDANCES
----------------------------------*/

// Npm
import path from 'path';

// Core
import { configureProjectAgentInstructions } from '../cli/utils/agents';

/*----------------------------------
- TYPES
----------------------------------*/

type TInputRoot = string | undefined;

/*----------------------------------
- MAIN PROCESS
----------------------------------*/

const proteumRoot = path.resolve(__dirname, '..');
const inputRoots = process.argv.slice(2) as TInputRoot[];
const projectRoots = (inputRoots.length === 0 ? [process.cwd()] : inputRoots).map((inputRoot) =>
    path.resolve(inputRoot || process.cwd()),
);

for (const projectRoot of projectRoots) {
    if (projectRoot === proteumRoot) {
        console.warn(`[update-codex-agents] Skipping Proteum root: ${projectRoot}`);
        continue;
    }

    console.log(`[update-codex-agents] Syncing project Codex assets in ${projectRoot}`);
    configureProjectAgentInstructions({ appRoot: projectRoot, coreRoot: proteumRoot });
}
