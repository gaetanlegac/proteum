// Regex: \/common\/forms\/.+\.ts$

/*----------------------------------
- DEPENDANCES
----------------------------------*/

// Core libs
import schema from '@validator';

// Core components
import Input from '@client/components/input';

/*----------------------------------
- TYPES
----------------------------------*/

export type TFormData = {
    email: string
}

/*----------------------------------
- VALIDTEURS
----------------------------------*/
// Rappel: Les validateurs associés au type de la propriété sont executés en priorité
export default schema.new({
    email: schema.string({
        rendu: Input,
        titre: "Your Email Address",
    }),
})