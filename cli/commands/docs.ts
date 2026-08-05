import { UsageError } from 'clipanion';
import fs from 'fs-extra';
import path from 'path';

import cli from '..';
import { renderRows } from '../presentation/layout';
import { renderStep, renderSuccess, renderTitle, renderWarning } from '../presentation/ink';

const { collectDocAnchors } = require('../../docAnchors.js') as {
    collectDocAnchors: (sourceText: string) => {
        adr: string[];
        docs: string[];
        fix: string[];
        entries: { line: number; tag: string; value: string }[];
    };
};

/*----------------------------------
- TYPES
----------------------------------*/

type TDocsCheckFinding = {
    detail: string;
    kind: 'unresolved-anchor' | 'ambiguous-anchor' | 'unanchored-fix-note' | 'orphan-feature-pack';
    subject: string;
};

type TDocsCheckReport = {
    anchoredFiles: number;
    findings: TDocsCheckFinding[];
    scannedFiles: number;
};

/*----------------------------------
- HELPERS
----------------------------------*/

const skippedDirectories = new Set([
    '.generated',
    '.git',
    '.proteum',
    'bin',
    'bin-dev',
    'dist',
    'node_modules',
    'var',
]);

const isSourceFile = (name: string) => /\.(ts|tsx|mts|cts)$/.test(name);

const walkSourceFiles = (directory: string, collected: string[] = []) => {
    let entries: { isDirectory: () => boolean; name: string }[] = [];
    try {
        entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch (error) {
        // An unreadable directory is not a documentation failure; skip it and
        // keep scanning so one permission problem cannot mask real findings.
        if (cli.verbose) console.warn(`docs check: skipping ${directory} (${(error as Error).message})`);
        return collected;
    }

    entries.forEach((entry) => {
        if (entry.name.startsWith('.') && entry.name !== '.') return;
        const full = path.join(directory, entry.name);
        if (entry.isDirectory()) {
            if (skippedDirectories.has(entry.name)) return;
            walkSourceFiles(full, collected);
            return;
        }
        if (isSourceFile(entry.name)) collected.push(full);
    });

    return collected;
};

/**
 * Resolve an anchor value the same way the `proteum/valid-doc-anchor` lint rule
 * does: against every ancestor of the file that holds a `docs/` directory, so a
 * monorepo app can point at the repository-level corpus.
 */
const resolveAnchorValue = (value: string, fromDirectory: string, root: string) => {
    if (path.isAbsolute(value)) return fs.existsSync(value);

    const roots: string[] = [];
    let current = fromDirectory;
    // The walk deliberately continues past `root`: running this from an app root
    // inside a monorepo must still resolve anchors aimed at the repository-level
    // corpus, exactly as the `proteum/valid-doc-anchor` lint rule does.
    while (current) {
        if (fs.existsSync(path.join(current, 'docs'))) roots.push(current);
        const parent = path.dirname(current);
        if (parent === current) break;
        current = parent;
    }
    if (!roots.includes(root)) roots.push(root);

    return roots.some((candidate) => fs.existsSync(path.resolve(candidate, value)));
};

/**
 * Resolve an `@adr` reference to the decision records whose filename starts with
 * it. Returns every match, because two records sharing an identifier makes the
 * reference ambiguous rather than merely valid.
 */
const resolveAdrReference = (value: string, fromDirectory: string, root: string) => {
    const normalized = value.trim().toLowerCase();
    if (!normalized) return [];

    const directories: string[] = [];
    let current = fromDirectory;
    while (current) {
        const candidate = path.join(current, 'docs', 'decisions');
        if (fs.existsSync(candidate)) directories.push(candidate);
        const parent = path.dirname(current);
        if (parent === current) break;
        current = parent;
    }

    const rootCandidate = path.join(root, 'docs', 'decisions');
    if (fs.existsSync(rootCandidate) && !directories.includes(rootCandidate)) directories.push(rootCandidate);

    // A project with no decisions corpus never fails this check.
    if (directories.length === 0) return null;

    return directories.flatMap((directory) =>
        fs
            .readdirSync(directory)
            .filter((entry) => entry.toLowerCase().startsWith(normalized))
            .map((entry) => path.relative(root, path.join(directory, entry))),
    );
};

const retiredPackPattern = /^\s*>?\s*RETIRED\b/im;
const notCodeOwnedPattern = /^\s*>?\s*code-owned:\s*false\s*$/im;

/**
 * A pack opts out of the orphan report by saying so in its README, either with
 * a `RETIRED` note or a `code-owned: false` line.
 *
 * Retirement records and intent documents describe decisions and audiences, not
 * modules, so no source file will ever point at them. Reporting those forever
 * trains a reader to ignore the whole list.
 */
const packOptsOutOfOrphanReport = (featuresDir: string, pack: string) => {
    const readme = path.join(featuresDir, pack, 'README.md');
    if (!fs.existsSync(readme)) return false;

    const content = fs.readFileSync(readme, 'utf8');
    return retiredPackPattern.test(content) || notCodeOwnedPattern.test(content);
};

const listFeaturePacks = (root: string) => {
    const featuresDir = path.join(root, 'docs', 'features');
    if (!fs.existsSync(featuresDir)) return [];

    return fs
        .readdirSync(featuresDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .filter((entry) => !packOptsOutOfOrphanReport(featuresDir, entry.name))
        .map((entry) => entry.name);
};

const listFixNotesRequiringAnchor = (root: string) => {
    const fixesDir = path.join(root, 'docs', 'fixes');
    if (!fs.existsSync(fixesDir)) return [];

    return fs
        .readdirSync(fixesDir)
        .filter((name) => name.endsWith('.md'))
        .filter((name) => /^## Agent warning\s*$/m.test(fs.readFileSync(path.join(fixesDir, name), 'utf8')));
};

export const buildDocsCheckReport = (root: string): TDocsCheckReport => {
    const files = walkSourceFiles(root);
    const findings: TDocsCheckFinding[] = [];
    const referencedPacks = new Set<string>();
    const referencedFixNotes = new Set<string>();
    let anchoredFiles = 0;

    files.forEach((filepath) => {
        const anchors = collectDocAnchors(fs.readFileSync(filepath, 'utf8'));
        if (anchors.entries.length === 0) return;

        anchoredFiles += 1;
        const relative = path.relative(root, filepath);

        anchors.docs.forEach((value) => {
            referencedPacks.add(path.basename(value.replace(/\/+$/, '')));
            if (!resolveAnchorValue(value, path.dirname(filepath), root)) {
                findings.push({ detail: `@docs ${value}`, kind: 'unresolved-anchor', subject: relative });
            }
        });

        anchors.fix.forEach((value) => {
            referencedFixNotes.add(path.basename(value));
            if (!resolveAnchorValue(value, path.dirname(filepath), root)) {
                findings.push({ detail: `@fix ${value}`, kind: 'unresolved-anchor', subject: relative });
            }
        });

        anchors.adr.forEach((value) => {
            const matches = resolveAdrReference(value, path.dirname(filepath), root);
            if (matches === null) return;

            if (matches.length === 0) {
                findings.push({ detail: `@adr ${value}`, kind: 'unresolved-anchor', subject: relative });
                return;
            }

            if (matches.length > 1) {
                findings.push({
                    detail: `@adr ${value} matches ${matches.length} records: ${matches.join(', ')}`,
                    kind: 'ambiguous-anchor',
                    subject: relative,
                });
            }
        });
    });

    listFixNotesRequiringAnchor(root).forEach((note) => {
        if (referencedFixNotes.has(note)) return;
        findings.push({
            detail: 'carries an Agent warning that no source file anchors',
            kind: 'unanchored-fix-note',
            subject: `docs/fixes/${note}`,
        });
    });

    listFeaturePacks(root).forEach((pack) => {
        if (referencedPacks.has(pack)) return;
        findings.push({
            detail: 'no source file points at this pack with @docs',
            kind: 'orphan-feature-pack',
            subject: `docs/features/${pack}`,
        });
    });

    return { anchoredFiles, findings, scannedFiles: files.length };
};

/*----------------------------------
- COMMAND
----------------------------------*/

const renderFindings = (findings: TDocsCheckFinding[], kind: TDocsCheckFinding['kind'], label: string) => {
    const matching = findings.filter((finding) => finding.kind === kind);
    if (matching.length === 0) return `${label}: none`;

    return [`${label}: ${matching.length}`, ...matching.map((finding) => `  ${finding.subject} | ${finding.detail}`)].join(
        '\n',
    );
};

export const run = async (): Promise<void> => {
    if (cli.args.action !== 'check') throw new UsageError('Usage: `proteum docs check`');

    const root = cli.paths.appRoot;

    console.info(
        [
            await renderTitle('PROTEUM DOCS CHECK', 'Checking that code and documentation still point at each other.'),
            renderRows([{ label: 'root', value: root === process.cwd() ? '.' : root }]),
            await renderStep('[1/1]', 'Resolving doc anchors.'),
        ].join('\n\n'),
    );

    const report = buildDocsCheckReport(root);
    const unresolved = report.findings.filter((finding) => finding.kind === 'unresolved-anchor');

    console.info(
        [
            renderRows([
                { label: 'files scanned', value: String(report.scannedFiles) },
                { label: 'files anchored', value: String(report.anchoredFiles) },
            ]),
            renderFindings(report.findings, 'unresolved-anchor', 'Unresolved anchors'),
            renderFindings(report.findings, 'ambiguous-anchor', 'Ambiguous anchors'),
            renderFindings(report.findings, 'unanchored-fix-note', 'Fix notes with no code anchor'),
            renderFindings(report.findings, 'orphan-feature-pack', 'Feature packs with no inbound anchor'),
        ].join('\n\n'),
    );

    // Only a broken pointer fails the command. Missing coverage is reported as a
    // backlog so a project can adopt anchors without a red build on day one.
    if (unresolved.length > 0)
        throw new Error(
            `Proteum docs check failed: ${unresolved.length} doc anchor(s) do not resolve. Update or remove them.`,
        );

    const backlog = report.findings.length;
    console.info(
        backlog > 0
            ? await renderWarning(`Anchors resolve. ${backlog} coverage gap(s) reported above.`)
            : await renderSuccess('All doc anchors resolve, and coverage is complete.'),
    );
};
