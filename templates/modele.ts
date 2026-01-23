// Regex: \/server\/models\/.+\.ts$

/*----------------------------------
- DEPENDANCES
----------------------------------*/
import Modele, {
    // Définitions
    Table, Column, API, Scopes,
    // Associations
    HasOne, HasMany
} from '@serveur/database/modele';

import Query from '@serveur/database/jsql/query/runner';

/*----------------------------------
- IMPORTATIONS TYPES
----------------------------------*/

import { Utilisateur } from '@modeles';

/*----------------------------------
- DEFINITIONS TYPES
----------------------------------*/


/*----------------------------------
- MODELE
----------------------------------*/
@Scopes([])
@Table('content', 'ModuleNames')
export default class ModuleName extends Modele {

    /*----------------------------------
    - IDENTIFICATION
    ----------------------------------*/
    @API() @Column()
    public id!: number;

    /*----------------------------------
    - AFFICHAGE
    ----------------------------------*/

    @API() @Column()
    public titre!: string;

    @Column()
    public createur_id!: number;
    @API() @HasOne(() => Utilisateur, { fk: 'createur_id' })
    public createur?: Utilisateur;

    /*----------------------------------
    - SCOPES
    ----------------------------------*/
    /*public static StatusStatic = () =>
        new Query<ModuleName>(Scope, {})*/
}