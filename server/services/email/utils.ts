/*----------------------------------
- DEPENDANCES
----------------------------------*/
// Npm
import dayjs from 'dayjs'; 
import escapehtml from 'escape-html';

/*----------------------------------
- FONCTIONS
----------------------------------*/
export const espacesVersHtml = (txt: string) => txt
    .replace(/(\n|\r)/g, '<br>') // Sauts de ligne
    .replace(/(\t)/g, '&nbsp;'.repeat(8)) // Tabulations
    .replace(/ /g, '&nbsp;') // Espaces
    /*.replace(/\"/g, '"') // Doubles quotes
    .replace(/\'/g, "'") // Doubles quotes*/

export const jsonToHtml = (objet: {[cle: string]: any}, complet: boolean = false): string => {

    let html: string[] = [];

    for (const label in objet) {

        let valeur = objet[label];

        if (valeur === undefined || valeur === null) {

            if (complet === true)
                // quand undefined, JSON.stringify retourne aussi undefined
                valeur = valeur === undefined 
                    ? 'undefined' 
                    : JSON.stringify(valeur, null, 4);
            else
                continue;
            
        } else if (typeof valeur === 'object') {

            if (valeur instanceof Date)
                valeur = dayjs(valeur).format('DD/MM/YYYY HH:mm:ss');

        }

        if (!valeur || typeof valeur !== 'string') 
            valeur = JSON.stringify(valeur, null, 4);

        html.push(
            '<b>' + label + ':</b> ' + espacesVersHtml(escapehtml(valeur))
        );
    }

    return html.join('<br>');
    
}
