import path from 'path';
import fs from 'fs-extra';

import writeIfChanged from '../writeIfChanged';
import type { TProteumManifest } from '@common/dev/proteumManifest';

export type {
    TProteumManifest,
    TProteumManifestCommand,
    TProteumManifestController,
    TProteumManifestDiagnostic,
    TProteumManifestDiagnosticLevel,
    TProteumManifestLayout,
    TProteumManifestRoute,
    TProteumManifestRouteTargetResolution,
    TProteumManifestScope,
    TProteumManifestService,
    TProteumManifestSourceLocation,
} from '@common/dev/proteumManifest';

export const getProteumManifestPath = (appRoot: string) => path.join(appRoot, '.proteum', 'manifest.json');

export const writeProteumManifest = (appRoot: string, manifest: TProteumManifest) =>
    writeIfChanged(getProteumManifestPath(appRoot), JSON.stringify(manifest, null, 2) + '\n');

export const readProteumManifest = (appRoot: string) => {
    const filepath = getProteumManifestPath(appRoot);

    if (!fs.existsSync(filepath)) {
        throw new Error(`Proteum manifest not found at ${filepath}. Run a Proteum command that refreshes generated artifacts first.`);
    }

    return fs.readJsonSync(filepath) as TProteumManifest;
};
