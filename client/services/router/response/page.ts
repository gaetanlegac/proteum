/*----------------------------------
- DEPENDANCES
----------------------------------*/

// Npm
import type { ComponentChild } from 'preact';

// Core
import type { TClientOrServerContextForPage, Layout, TRoute, TErrorRoute } from '@common/router';
import PageResponse, { TFrontRenderer } from "@common/router/response/page";

// Specific
import type ClientRouter from '..';

/*----------------------------------
- TYPES
----------------------------------*/



/*----------------------------------
- CLASS
----------------------------------*/

export default class ClientPage<TRouter = ClientRouter> extends PageResponse<TRouter> {

    public scrollToId: string;

    public constructor(
        public route: TRoute | TErrorRoute,
        public component: TFrontRenderer,
        public context: TClientOrServerContextForPage,
        public layout?: Layout
    ) {

        super(route, component, context);

        this.bodyId = context.route.options.bodyId;
        this.scrollToId = context.request.hash;
        
    }
    
    public async preRender( data?: TObjetDonnees ) {

        // Add the page to the context
        this.context.page = this;

        // Data succesfully loaded
        this.context.data = this.data = data || await this.fetchData();

        return this;
    }

   /*----------------------------------
    - ACTIONS
    ----------------------------------*/
    // Should be called AFTER rendering the page
    public updateClient() {

        document.body.id = this.bodyId || this.id;
        document.title = this.title || APP_NAME;
        document.body.className = [...this.bodyClass].join(' ');
        
    }

    public setAllData( callback: (data: {[k: string]: any}) => void) { 
        console.warn(`page.setAllData not yet attached to the page Reatc component.`); 
    }
    public setData( key: string, value: ((value: any) => void) | any ) {
        this.setAllData(old => ({ 
            ...old, 
            [key]: typeof value === 'function' ? value(old[key]) : value 
        }));
    }

    public setLoading(state: boolean) {

        if (state === true) {
            if (!document.body.classList.contains("loading"))
                document.body.classList.add("loading");
        } else {
            document.body.classList.remove("loading");
        }

    }
}