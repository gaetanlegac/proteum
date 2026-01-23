import type { TKeyword, TBlock } from '.';

/*----------------------------------
- CONSTANTES
----------------------------------*/
export const keywordsBase: TKeyword[] = [

    { type: 'root',},
    { type: 'group',},

    { type: 'bloc', start: '(', end: ')' },
    { type: 'literal', start: '"', end: '"', parse: false },
    { type: 'literal', start: "'", end: "'", parse: false },
    { type: 'comment', start: '/*', end: '*/', parse: false, exclude: true },

    { type: 'item', delim: ',' }
]

export const whitespaces = [' ', '\n', '\t', '\r']

export const couleurs = [
    "\x1b[31m",
    "\x1b[32m",
    "\x1b[33m",
    "\x1b[34m",
    "\x1b[35m",
    "\x1b[36m",
]

/*----------------------------------
- OUTILS
----------------------------------*/
export const isEmpty = (content: string) => /^[\s]*$/.test(content);

export const getCouleur = (level: number) => level <= 0 ? '\x1b[0m' : couleurs[level % couleurs.length]

export const print = (bloc: TBlock | string, opts: { balises?: boolean } = {}, level: number = 0): string => {

    const couleurParent = getCouleur(level - 1);
    const couleurA = getCouleur(level);
    const couleurEnfant = getCouleur(level + 1);

    if (typeof bloc === 'string') {
        return (
            (opts.balises ? ('\x1b[90m<txt' + level + '>') : '')
            +
            (bloc ? (couleurA + bloc) : '')
            +
            (opts.balises ? ('\x1b[90m</txt' + level + '>') : '')
        ).trim() + couleurParent
    } else {

        let content: any = '';
        if (bloc.content.length) {
            content = couleurEnfant + bloc.content.map((children) => print(children, opts, level + 1)).join(bloc.delim);

            const indent = '\n' + ' '.repeat(2 * level)
            if (bloc.type === 'bloc')
                content = indent + content.replace(/\n/g, indent) + '\n'
        }

        return (
            (opts.balises ? ('\x1b[90m<' + bloc.type + level + '>') : '')
            +
            (bloc.keyword?.start ? (couleurA + (bloc.callee ? bloc.callee : '') + bloc.keyword.start + (bloc.keyword?.class === 'instruction' ? ' ' : '')) : '')
            +
            content
            +
            (bloc.keyword?.end ? (couleurA + bloc.keyword.end) : '')
            +
            (opts.balises ? ('\x1b[90m</' + bloc.type + level + '>') : '')
        ).trim() + couleurParent
    }
}

export const arbo = (bloc: TBlock | string, level: number = 0): string => {
    return ' '.repeat(level * 4) + (typeof bloc === 'string'
        ? 'text'
        : bloc.type + '\n' + bloc.content.map((child) => arbo(child, level + 1)).join('')
    ) + '\n';
}

export const blockToString = (bloc: TBlock | string) => {
    return typeof bloc === 'string' 
        ? bloc 
        : bloc.content.map((child) => typeof child === 'string' ? child : (
            (child.callee ? child.callee : '')
            +
            (child.keyword?.start ? (child.keyword?.start + (child.keyword?.class === 'instruction' ? ' ' : '')) : '')
            +
            child.raw
            +
            (child.keyword?.end ? child.keyword?.end : '')
        ).trim()).join(bloc.delim)
}