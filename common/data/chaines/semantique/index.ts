/*----------------------------------
- DEPENDANCES
----------------------------------*/

import {
    keywordsBase,
    whitespaces,
    isEmpty,
    print,
    blockToString,
} from './tools';

export * from './tools'

const util = require('util')

/*----------------------------------
- TYPES
----------------------------------*/
type TBlockType = 'bloc' | 'quotes' | 'quote' | 'comment' | 'item' | 'root' | 'group' | 'instruction'

export type TKeyword = {
    type: TBlockType,
    start?: string, 
    end?: string,
    delim?: string,

    class?: string,

    parse?: boolean,
    exclude?: boolean
}

export type TBlock<TKeywordBloc extends TBlockType = TBlockType> = {

    // Identification
    type: TKeywordBloc,
    keyword?: TKeyword,
    parent: TBlock | TRootBlock,

    // Contenu
    content: (TBlock | string)[]
    raw: string,
    delim: string,

    // Etat
    isList?: boolean,
    insertNewItem?: boolean,
    exclude?: boolean,
    closed?: boolean,
}

type TRootBlock = Omit<TBlock<'root'>, 'parent'> & {
    parent: undefined
}

type TOpts = {
    keywords?: TKeyword[],
    onBegin?: (bloc: TBlock) => void,
    onClose?: (bloc: TBlock) => void,
    debug?: boolean,
    root?: Partial<TBlock>
}

/*----------------------------------
- FONCTION
----------------------------------*/
export default function semantique(
    input: string,
    { keywords, onBegin, onClose, debug, root: initRoot }: TOpts = {}
): TBlock {

    // Init
    let iActuel: number = 0;
    const iMax = input.length - 1;

    keywords = keywords ? [ ...keywordsBase, ...keywords ] : [ ...keywordsBase ]

    const createBlock = (bloc: Pick<TBlock, 'type' | 'parent' | 'keyword'> & Partial<TBlock>): TBlock => ({
        content: [],
        raw: '',
        delim: bloc.type === 'literal' ? '' : ' ',
        ...bloc
    })

    // Création blocs de base
    const root: TRootBlock = createBlock({
        ...initRoot,
        type: 'root',
    })
    let bloc = root;
    let buffer: string = '';

    //try {

        /*----------------------------------
        - FONCTIONS
        ----------------------------------*/
        const addContent = (newChild: TBlock | string, bloc: TBlock | TRootBlock): void => {

            // Bloc fermé
            if (bloc.closed)
                throw new Error(`Impossible d'ajouter un enfant car le bloc a été fermé.`);

            // Pas besoin de traiter le bloc s'il a été marqué comme exclu
            if (typeof newChild === 'string')
                newChild = newChild.trim();
            else if (newChild.exclude === true)
                return;

            if (bloc.isList) {

                // NOTE: Les élements d'un bloc liste sont tous séparés d'une virgule
                // On fera donc attention de ne pas séparer deux élements (ex: texte + bloc, deux blocs ensemble, ...) 

                // Ajout d'un nouvel item
                const nbChild = bloc.content.length;
                if (bloc.insertNewItem === true) {

                    // Premier item de la liste = regroupe tous les items précédents
                    if (bloc.lastItemIndex === undefined && nbChild > 1) {

                        bloc.content = [
                            createBlock({
                                type: 'group',
                                parent: bloc,
                                content: [...bloc.content]
                            })
                        ]

                    }

                    // Ajout du nouvel item
                    bloc.content.push(newChild);
                    bloc.insertNewItem = false;
                    bloc.lastItemIndex = nbChild

                // Pas un noovel item = Fusion avec élement précédent quand possible
                } else if (nbChild > 0) {

                    const iLastChild = nbChild - 1
                    const lastChild = bloc.content[iLastChild ];

                    // Précédent = groupe: ajout de l'élement à ce groupe
                    if (typeof lastChild === 'object' && lastChild.type === 'group') {

                        lastChild.content.push( newChild );

                    // Nouveau groupe
                    } else {

                        bloc.content[iLastChild] = createBlock({
                            type: 'group',
                            parent: bloc,
                            content: [lastChild, newChild]
                        })

                    }

                } else
                    bloc.content.push(newChild);


            } else
                bloc.content.push(newChild);
        }

        const flushBuffer = (delim?: string) => {
            if (buffer !== '') {

                // Retire le déliliteur de fin du contenu du bloc
                if (delim !== undefined)
                    buffer = buffer.substring(0, buffer.length - delim.length);

                // Finalise le contenu actuel si pas déjà fait
                if (!isEmpty(buffer))
                    addContent(buffer, bloc)

                buffer = '';

            }
        }

        const closeBlock = (bloc: TBlock): void => {

            if (bloc.closed === true)
                return;

            // Ferme également tous les enfants n'ayant pas été fermés
            // On les ferme avant le parent afin de pouvoir utiliser raw qui a déjà été calculé
            for (const child of bloc.content) {
                if (typeof child === 'object')
                    closeBlock(child);
            }

            // Génère le contenu brut
            bloc.raw = blockToString(bloc);

            if (onClose !== undefined)
                onClose(bloc)

            bloc.closed = true;

        }

        const detectStopword = (): false | { bloc: TBlock | TRootBlock, stopword: string } => {

            // Recherche d'un stopword
            let blockToClose: TBlock | TRootBlock = bloc;
            let stopwordAttendu: string | undefined;
            while (blockToClose !== undefined) {

                const stopword = blockToClose.keyword?.end
                if (stopword !== undefined) {

                    if (buffer.endsWith(stopword)) {

                        // Détection stopword en trop
                        // Un autre stopword est attendu
                        // = Un bloc enfant n'a pas été fermé
                        if (stopwordAttendu !== undefined && stopwordAttendu !== stopword) {
                            //console.log(  );
                            throw new Error(`Le stopword « ${stopword} » a été detecté, alors que la fermeture d'un bloc enfant était attendue via le stopword « ${stopwordAttendu} » dans « ${buffer} ».`);
                        }

                        return { bloc: blockToClose, stopword };

                    } else
                        stopwordAttendu = stopword;
                }

                // Si le bloc ne doit pas être interprété (ex: commentaire),
                // On ne recherche pas d'autre stopword que celui du bloc en question
                if (bloc.keyword?.parse === false)
                    return false;
                // Sinon, Vérif parent au dessus
                else
                    blockToClose = blockToClose.parent;
            }

            return false;
        }

        const detectKeyword = (prevContent: string, char: string): false | { delim: string, keyword: TKeyword } => {
            for (const newKeyword of keywords) {

                // Délimiteur de bloc disponible
                let delim = newKeyword.start || newKeyword.delim;
                if (delim === undefined) continue;

                // Détection keyword
                let keywordDetecte: boolean;
                if (newKeyword.class === 'instruction') {
                    // Le mot clé d'une instruction est toujours suivi d'un espace
                    keywordDetecte = whitespaces.includes(char) && prevContent.endsWith(delim);
                    delim += char;
                } else
                    keywordDetecte = buffer.endsWith(delim)

                if (keywordDetecte === true)
                    return { delim, keyword: newKeyword };

            }
            return false;
        }

        /*----------------------------------
        - PARCOURS CARACTÈRES
        ----------------------------------*/
        // Itération des caractères
        parcoursCaractères:
        while (iActuel <= iMax) {

            // Incrémentation du contenu de l'enfant
            const char = input[iActuel]
            const charPreced = input[iActuel - 1]
            const prevContent = buffer;
            buffer += char

            //console.log('BUFFER', bloc.type, buffer);

            // Fin bloc: Remonte jusqi'à la raicne pour vérifier si l'un des parent n'est pas fermé
            const closing = detectStopword();
            if (closing !== false) {

                // Ferme également tous les enfants
                flushBuffer(closing.stopword);
                closeBlock(closing.bloc);

                // Le bloc root a été terminé (seul le bloc root n'a pas de parent)
                if (closing.bloc.type === 'root') {

                    break parcoursCaractères;

                } else {

                    // Retour au parent 
                    bloc = closing.bloc.parent;

                    iActuel++;
                    continue parcoursCaractères;
                }
            }

            // Dernier caractère = on devrait se trouver à la racine
            if (iActuel === iMax) {

                flushBuffer();
                closeBlock(bloc);

                // Détection stopword manquant
                // Vérifie si le bloc actuel ainsi que ses parents ont besoin d'être fermés
                let blocAverifier: TBlock | undefined = bloc
                while (blocAverifier !== undefined) {

                    if (blocAverifier.keyword?.end !== undefined)
                        throw new Error(`Un élement de type ${blocAverifier.type} n'a pas été fermé (stopword « ${blocAverifier.keyword.end} » attendu)`);

                    blocAverifier = blocAverifier.parent

                }

                break parcoursCaractères;
            }

            iActuel++;

            // On ne recherche pas de nouveau bloc dans les litérals
            if (bloc.keyword?.parse === false) {
                continue;
            }

            // Debut bloc
            const opening = detectKeyword(prevContent, char);
            if (opening !== false) {

                // Si texte collé au bloc (ex: COUNT(*)), alors ce texte devient le prefixe du nouveau bloc
                let functionName: string | undefined;
                /*if (opening.keyword.type === 'bloc' && charPreced !== undefined && !whitespaces.includes(charPreced)) {

                    // Extraction nom fonction
                    const iPosNomFunc = buffer.lastIndexOf(' ');
                    functionName = buffer.substring(iPosNomFunc + 1, buffer.length - opening.delim.length);
                    
                    // Retire le nom de la fonction du buffer
                    if (iPosNomFunc === -1)
                        buffer = '';
                    else {
                        buffer = buffer.substring(0, iPosNomFunc)

                        console.log('FUNCTION', buffer, '||', functionName);

                        // Le délimiteur a déjà été retiré du buffer
                        flushBuffer()
                    }

                } else*/
                    // Finalise le contenu actuel si pas déjà fait
                    flushBuffer( opening.delim );

                // Ouverture d'un nouveau bloc À COTÉ du bloc actuel
                if (opening.keyword.type === 'item') {

                    bloc.isList = true;
                    bloc.delim = ', ';

                    // Le prochain élement devra être ajouté à la liste
                    bloc.insertNewItem = true;

                // Ouverture d'un nouveau bloc À L'INTERIEUR le bloc actuel
                } else {

                    const newBlock = createBlock({
                        parent: bloc,
                        type: opening.keyword.type,
                        keyword: opening.keyword,
                        //callee: functionName
                    })

                    if (opening.keyword.class === 'instruction') {

                        // Une nouvelle instruction ferme l'actuelle
                        if (bloc.keyword?.class === 'instruction') {

                            // Ferme et Quitte l'instruction actuelle
                            closeBlock(bloc);
                            bloc = bloc.parent;
                            newBlock.parent = bloc
                        }

                    }

                    if (opening.keyword.exclude === true)
                        newBlock.exclude = true;
                    else if (onBegin !== undefined) {

                        onBegin( newBlock )

                    }

                    if (newBlock.exclude !== true)
                        addContent(newBlock, bloc);

                    // Basculement sur le nouveau bloc
                    bloc = newBlock

                }
            }
            
        }

        closeBlock(root);

    /*} catch (error) {

        console.log( 
            "[semantique] Source de l'erreur ci-dessous:\n",
            input.substring(0, iActuel) + '\x1b[41m' + input[iActuel] + '\x1b[0m' + input.substring(iActuel + 1) 
        );
        throw error;

    }*/
    
    if (debug) {
        console.log(`[sementique] Input:\n`, input);
        /*console.log(`[sementique] AST:\n`, util.inspect(root, {
            showHidden: false,
            depth: 10,
            colors: true
        }))*/
        console.log(`[sementique] Output:\n`, print(root, { balises: true }) );
    }

    //console.log( `[sementique] Arbo:\n`, arbo(root) );

    return root;
}