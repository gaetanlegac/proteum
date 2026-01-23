/*----------------------------------
- DEPENDANCES
----------------------------------*/

// Npm
import React from 'react';
import type { ComponentChild } from 'preact';

// Core
import RouterComponent from '@client/services/router/components/router';
import { ClientContext } from '@/client/context';

// Core components

// Resources
import "./index.less";

/*----------------------------------
- TYPES
----------------------------------*/


/*----------------------------------
- COMPOSANT
----------------------------------*/
export default function App ({ context, menu }: { 
    context: ClientContext,
    menu: ComponentChild
}) {

    const { Router, page, toast } = context;

    return (
        <div id="internaLlayout">

            <div class="center row al-fill">

                <RouterComponent service={Router} />
                
            </div>
        </div>
    )
}