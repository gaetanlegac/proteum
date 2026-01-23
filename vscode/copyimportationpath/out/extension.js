"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.deactivate = exports.activate = void 0;
const vscode = require("vscode");
const fs = require('fs');
const json5 = require('json5');
const path = require('path');
var minimatch = require("minimatch");
function activate(context) {
    const regEntete = /^\/\/\s+([a-z]+)\:\s+(.+)/i;
    const templates = {};
    const dossierTemplates = path.join(context.extensionPath, '../..', 'templates');
    if (!fs.existsSync(dossierTemplates)) {
        console.log("Template folder not existing:", dossierTemplates);
        return;
    }
    //const dossierTemplates = workspace + '/../node_modules/@dopamyn/framework/templates';
    fs.readdir(dossierTemplates, (err, files) => {
        console.log("Lecture de", dossierTemplates, files);
        if (err)
            return console.error(err);
        for (const file of files) {
            const nom = file.substring(0, file.lastIndexOf('.'));
            let content = fs.readFileSync(dossierTemplates + '/' + file, { encoding: 'utf-8' });
            const entete = regEntete.exec(content);
            if (!entete) {
                console.error(file + `: Entete manquante ou au mauvais format.`);
                continue;
            }
            console.log('Template', file, nom, entete[1], entete[2]);
            // Retire l'entete de la template
            content = content.substring(entete[0].length).trim();
            templates[nom] = { content };
            if (entete[1] === 'Glob')
                templates[nom].glob = entete[2];
            else if (entete[1] === 'Regex')
                templates[nom].regex = new RegExp(entete[2]);
            else
                console.error(file + `: Entete inconnue: ` + entete[1]);
        }
        console.log(templates);
    });
    vscode.workspace.onDidCreateFiles((e) => __awaiter(this, void 0, void 0, function* () {
        for (const file of e.files) {
            const importPath = yield getImportPath(file.path);
            const importName = getImportName(importPath, file.path);
            console.log("Fichier créé:", file.path, importPath);
            // Remplacements
            for (const nom in templates) {
                const { glob, regex, content } = templates[nom];
                let match;
                if ((glob && minimatch(file.path, glob)) || (match = regex === null || regex === void 0 ? void 0 : regex.exec(file.path))) {
                    const remplacements = Object.assign({ NAMELOWER: importName.toLowerCase(), NAME: importName, ABSPATH: importPath }, ((match === null || match === void 0 ? void 0 : match.groups) || {}));
                    console.log("Template:", nom, "Remplacements:", remplacements);
                    fs.writeFileSync(file.path, content.replace(new RegExp(Object.keys(remplacements).join('|'), 'g'), (match) => remplacements[match]));
                    break;
                }
            }
        }
    }));
    const readTsConfig = (chemin, workspace) => __awaiter(this, void 0, void 0, function* () {
        var _a;
        console.log('Lecture de ' + chemin);
        const rawtsconfig = fs.readFileSync(chemin, { encoding: 'utf-8' });
        const tsconfig = json5.parse(rawtsconfig);
        const paths = (_a = tsconfig.compilerOptions) === null || _a === void 0 ? void 0 : _a.paths;
        if (paths !== undefined) {
            // Les plus specifiques en premiers
            let retour = [];
            for (let alias in paths) {
                let chemin = path.join(workspace, paths[alias][0]);
                const partiel = chemin.endsWith('*');
                if (partiel) {
                    // Retire le * à la fin
                    chemin = chemin.substring(0, chemin.length - 1);
                    alias = alias.substring(0, alias.length - 1);
                }
                retour.push({
                    partiel,
                    alias,
                    chemin
                });
            }
            retour.sort((a, b) => b.chemin.length - a.chemin.length);
            return retour;
        }
        else if (tsconfig.extends !== undefined)
            return yield readTsConfig(path.resolve(path.dirname(chemin), tsconfig.extends), workspace);
        else
            return [];
    });
    const removeExtensions = (fichier, extensions) => {
        for (const extension of extensions) {
            console.log(extension, fichier);
            if (fichier.endsWith('.' + extension)) {
                fichier = fichier.substring(0, fichier.length - extension.length - 1);
                break;
            }
        }
        if (fichier.endsWith('/index'))
            fichier = fichier.substring(0, fichier.length - 6);
        return fichier;
    };
    const getListeAlias = () => __awaiter(this, void 0, void 0, function* () {
        var _b;
        if (!((_b = vscode.workspace.workspaceFolders) === null || _b === void 0 ? void 0 : _b.length)) {
            console.error(`Impossible de récupérer le dossier du workspace actuel`);
            return [];
        }
        const workspace = vscode.workspace.workspaceFolders[0].uri.path;
        const tsconfigs = yield vscode.workspace.findFiles('tsconfig.json');
        if (tsconfigs.length === 0)
            return [];
        return yield readTsConfig(tsconfigs[0].path, workspace);
    });
    const getImportPath = (fichier) => __awaiter(this, void 0, void 0, function* () {
        const listeAlias = yield getListeAlias();
        console.log('fichier =', fichier);
        console.log('listeAlias =', listeAlias);
        for (const alias of listeAlias) {
            // Remplacement prefixe
            if (alias.partiel) {
                if (fichier.startsWith(alias.chemin)) {
                    fichier = alias.alias + fichier.substring(alias.chemin.length);
                    break;
                }
                // Remplacement complet
            }
            else {
                if (fichier === alias.chemin) {
                    fichier = alias.alias;
                    break;
                }
            }
        }
        // Vire l'extension
        fichier = removeExtensions(fichier, ['tsx', 'ts', 'js', 'jsx']);
        return fichier;
    });
    const findImportPath = (selectedFile) => __awaiter(this, void 0, void 0, function* () {
        let fichier;
        if (selectedFile)
            fichier = selectedFile.path;
        else {
            if (!vscode.window.activeTextEditor)
                return console.error(`Aucun editeur actif`);
            fichier = vscode.window.activeTextEditor.document.uri.path;
        }
        return yield getImportPath(fichier);
    });
    const getImportName = (importPath, originalPath) => {
        const content = fs.readFileSync(originalPath, { encoding: 'utf-8' });
        const exportdefault = /export default\s+(function|class|new)\s+([a-zA-Z]+)/.exec(content);
        let nomModule;
        if (exportdefault) {
            nomModule = exportdefault[2];
        }
        else {
            const posSlash = importPath.lastIndexOf('/');
            nomModule = importPath.substring(posSlash === -1 ? 0 : posSlash + 1);
            nomModule = nomModule[0].toUpperCase() + nomModule.substring(1);
        }
        return nomModule;
    };
    const copier = (txt) => {
        console.log(txt);
        vscode.env.clipboard.writeText(txt);
        //vscode.window.showInformationMessage('Copied ' + txt);
    };
    context.subscriptions.push(vscode.commands.registerCommand('copyimportationpath.copy', (selected) => __awaiter(this, void 0, void 0, function* () {
        try {
            const fichier = yield findImportPath(selected);
            if (fichier)
                copier(fichier);
        }
        catch (error) {
            vscode.window.showErrorMessage(error.toString());
            console.error(error);
        }
    })), vscode.commands.registerCommand('copyimportationpath.copyStatement', (selected) => __awaiter(this, void 0, void 0, function* () {
        try {
            const importPath = yield findImportPath(selected);
            if (importPath) {
                const importName = getImportName(importPath, selected.path);
                copier(`import ${importName} from '${importPath}';`);
            }
        }
        catch (error) {
            vscode.window.showErrorMessage(error.toString());
            console.error(error);
        }
    })));
}
exports.activate = activate;
function deactivate() { }
exports.deactivate = deactivate;
//# sourceMappingURL=extension.js.map