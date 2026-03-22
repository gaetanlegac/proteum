/*----------------------------------
- DEPENDANCES
----------------------------------*/

// Npm
import React from 'react';

// Core
import type { Layout } from '@common/router';
import type { LayoutProps } from '@common/router/layouts';
import { ReactClientContext, type ClientContext } from '@/client/context';
import DialogManager from '@client/components/Dialog/Manager';

// Core components
import RouterComponent from '@client/services/router/components/router';

/*----------------------------------
- COMPOSANT
----------------------------------*/
export default function App({ context }: { context: ClientContext }) {
    const curLayout = context.page?.layout;
    const [layout, setLayout] = React.useState<Layout | false | undefined>(curLayout);
    const [apiData, setApiData] = React.useState<{ [k: string]: any } | null>(context.page?.data || {});

    // TODO: context.page is always provided in the context on the client side
    if (context.app.side === 'client') context.app.setLayout = setLayout;

    const layoutProps: LayoutProps = {
        ...context,
        context,
        data: { ...apiData, ...context.request.data },
        menu: undefined,
        children: undefined,
    };

    return (
        <ReactClientContext.Provider value={context}>
            <DialogManager />

            {!layout ? (
                <>
                    {/* TODO: move to app, because here, we're not aware that the router service has been defined */}
                    <RouterComponent service={context.Router} />
                </>
            ) : (
                <>
                    {' '}
                    {/* Same as router/components/Page.tsx */}
                    <layout.Component {...layoutProps} />
                </>
            )}
        </ReactClientContext.Provider>
    );
}
