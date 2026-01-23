// Regex: \/Modal([A-Z][a-zA-Z]+)?\.tsx$

/*----------------------------------
- DEPENDANCES
----------------------------------*/

// Npm
import React from 'react';

// Cre libs
import useContext from '@/client/context';

// Core components
import Card, { Props as CardProps } from '@client/components/Dialog/card';
import Button from '@client/components/Button';

/*----------------------------------
- COMPOSANT
----------------------------------*/
export default ({ close, ...props }: Partial<CardProps>) => {

    const { api, modal } = useContext();

    const send = () => api.post('/auth/getinvite', {  }).then(() => {

        modal.success('Yeah !', "It's ok");
        close(true);

    });

    return (
        <div class="card col" title="Hello" {...props}>

            <header class="row">
                <h2>Hello</h2>
            </header>

            <p>This is a text</p>

            <footer class="row actions fill">
                <Button iconR="long-arrow-right" async onClick={send}>
                    Continue
                </Button>
            </footer>
        </div>
    )
}