import fs from 'fs-extra';
import path from 'path';

import type { Application } from './index';
import {
    buildDoctorResponse,
    explainSectionNames,
    pickExplainManifestSections,
    type TDoctorResponse,
    type TExplainSectionName,
} from '@common/dev/diagnostics';
import type { TProteumManifest } from '@common/dev/proteumManifest';

const isExplainSectionName = (value: string): value is TExplainSectionName =>
    explainSectionNames.includes(value as TExplainSectionName);

export default class DevDiagnosticsRegistry<TApplication extends Application = Application> {
    public constructor(private app: TApplication) {}

    private getManifestFilepath() {
        return path.join(this.app.container.path.root, '.proteum', 'manifest.json');
    }

    public readManifest(): TProteumManifest {
        const filepath = this.getManifestFilepath();
        if (!fs.existsSync(filepath)) {
            throw new Error(`Proteum manifest not found at ${filepath}. Run a Proteum command that refreshes generated artifacts first.`);
        }

        return fs.readJsonSync(filepath) as TProteumManifest;
    }

    public normalizeExplainSections(rawSections: string[]) {
        const sections = [...new Set(rawSections.map((section) => section.trim()).filter(Boolean))];
        const invalidSections = sections.filter((section) => !isExplainSectionName(section));

        if (invalidSections.length > 0) {
            throw new Error(
                `Unknown explain section(s): ${invalidSections.join(', ')}. Allowed values: ${explainSectionNames.join(', ')}.`,
            );
        }

        return sections as TExplainSectionName[];
    }

    public explain(sectionNames: TExplainSectionName[] = []) {
        return pickExplainManifestSections(this.readManifest(), sectionNames);
    }

    public doctor(strict = false): TDoctorResponse {
        return buildDoctorResponse(this.readManifest(), strict);
    }
}
