/*----------------------------------
- DEPENDANCES
----------------------------------*/

// Npm
import mime from 'mime-types';

// Core
import { InputError } from '@common/errors';

/*----------------------------------
- TYPES
----------------------------------*/

import type { Request, Response, NextFunction } from 'express';
import type { FileArray, UploadedFile } from 'express-fileupload';

/*----------------------------------
- CONFIG
----------------------------------*/
const reMultipart = /^multipart\/(?:form-data|related)(?:;|$)/i;

/*----------------------------------
- MIDDLEWARE
----------------------------------*/
export const MiddlewareFormData = (req: Request, res: Response, next: NextFunction) => {

    // Verif si multipart
    if (!isMutipart( req ))
        return next();
        
    // Données body + fichiers
    // NOTE: Les données devant obligatoirement passer par le validateur de schema, 
    //  On peut mélanger le body et les files sans risque de sécurité
    req.body = traiterMultipart(req.body, req['files']);
    //req.files = traiterMultipart(req.files);

    next();
}

/*----------------------------------
- FUNCTIONS
----------------------------------*/
export const isMutipart = (req: Request) => req.headers['content-type'] && reMultipart.exec( req.headers['content-type'] );

export const traiterMultipart = (...canaux: any[]) => {

    let sortie: {[nom: string]: any} = {};

    for (const donnees of canaux) {

        if (!donnees)
            continue;

        for (const fieldPath in donnees) {
            let donnee = donnees[fieldPath];

            let brancheA = sortie;
            const results = [...fieldPath.matchAll(/[^\[\]]+/g)];
            for (let iCle = 0; iCle < results.length; iCle++) {

                const [cle] = results[ iCle ];

                // Need to go deeper to find data
                if (iCle !== results.length - 1) {

                    if (brancheA[ cle ] === undefined) {
                        const tableau = !isNaN( results[ iCle + 1 ][0] as any )
                        brancheA[ cle ] = tableau ? [] : {};
                    }

                    brancheA = brancheA[ cle ];
                    continue;
                }

                // Data reached
                if (
                    typeof donnee === 'object' 
                    && 
                    donnee.data !== undefined 
                    && 
                    donnee.data instanceof Buffer
                ){
                    const md5 = donnee.md5;
                    const data = donnee.data;
                    donnee = new File(donnee.data, donnee.name, { 
                        type: donnee.mimetype,
                        lastModified: Date.now(),
                        //size: donnee.size,
                    });

                    donnee.md5 = md5;
                    donnee.data = data;
                }
                
                brancheA[ cle ] = donnee;
            }
        }
    }

    return sortie;
}