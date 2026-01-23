import React from 'react';

type TAttributs = {
    dataset?: {[nom: string]: any},
    attributs?: {[nom: string]: any},
    onload?: Function,
}

export default (
    javascript: string, 
    opts: TAttributs | TAttributs['onload'] = {}, 
    autoload: boolean = true
) => {

    if (typeof document === 'undefined')
        return;

    const script = React.useRef<HTMLScriptElement>();
    const head = document.getElementsByTagName('head')[0]

    if (typeof opts === 'function')
        opts = {
            onload: opts
        }

    const { attributs, dataset, onload } = opts;

    const charger = () => {

        if (script.current)
            head.removeChild(script.current);

        script.current = document.createElement('script');
        script.current.type = 'text/javascript';

        if (javascript.startsWith('https://'))
            script.current.src = javascript;
        else
            script.current.innerHTML = javascript;

        if (onload !== undefined)
            script.current.onload = onload;

        if (attributs !== undefined)
            for (const nomAttr in attributs)
                script.current[nomAttr] = attributs[nomAttr];

        if (dataset !== undefined)
            for (const nomData in dataset)
                script.current.dataset[nomData] = dataset[nomData];

        head.appendChild(script.current);
    }

    React.useEffect(() => {

        if (autoload)
            charger();

        return () => {
            if (script.current)
                head.removeChild(script.current);
        }

    }, []);

    return {
        recharger: () => charger()
    }
}