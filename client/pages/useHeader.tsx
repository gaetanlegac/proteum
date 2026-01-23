/*----------------------------------
- DEPENDANCES
----------------------------------*/

// Core
import useContext from '@/client/context';

/*----------------------------------
- TYPES
----------------------------------*/
export type Props = {
    id?: string,
    focus?: boolean,
    jail?: boolean,
    error?: boolean,

    title: string,
    subtitle?: string,
    description?: string,
}

/*----------------------------------
- HOOK
----------------------------------*/
export default ({ id, title, subtitle, focus, jail, description }: Props) => {

    let { page } = useContext();

    // page est supposé ne pas être undefined
    if (!page)
        return;

    // SEO Title
    page.title = title;
    if (subtitle !== undefined)
        page.title += ' | ' + subtitle;

    // SEO Description
    if (description !== undefined)
        page.description = description;

    page.bodyId = page.bodyId || id || '';

    if (focus)
        page.bodyClass.add('focus');

    if (jail)
        page.bodyClass.add('jail');
    
}