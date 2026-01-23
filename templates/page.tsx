// Regex: \/client\/pages\/(?<PATH>.+)\.tsx$

/*----------------------------------
- DEPENDANCES
----------------------------------*/

// Npm
import React from 'react';

// Core
import route from '@router';
import { useState } from '@/client/context';

// Core components
import Button from '@client/components/Button';

// App
import Page from '@client/pages/_layout/app/Page';
import type { NAME } from '@/server/libs/PATH';

/*----------------------------------
- CONTROLEUR
----------------------------------*/
route.page('/PATH', { }, ({}, { api }) => ({

    NAMELOWERs: api.get('/PATH')

}), ({ NAMELOWERs }, { api, modal, toast, user }) => {

    /*----------------------------------
    - STATE
    ----------------------------------*/

    const [{ state }, setState] = useState<{
        state: string
    }>({
        state: ""
    });

    /*----------------------------------
    - ACTIONS
    ----------------------------------*/

    const action = () => api.post('/PATH', {  }).then(() => {
        modal.success('Yeah !', "It's ok");
        close(true);
    });

    /*----------------------------------
    - RENDER
    ----------------------------------*/
    return (
        <Page breadcrumb={{ Parent: null }} title="NAME" subtitle="Subtitle" actions={<>

            <ul id="actions" class="row al-left wrap">

                <li class="row stat m card color-1">
                    <i src="wallet" class="solid" />
                    <div class="label">
                        Name
                        <strong>Number</strong>
                    </div>
                </li>

            </ul>
        
        </>}>

           

        </Page>
    )

});