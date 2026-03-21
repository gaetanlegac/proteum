/*----------------------------------
- DEPENDANCES
----------------------------------*/

// Npm
import React from 'react';

// Core
import useContext from '@/client/context';

// Specific
import type ClientRouter from '..';
import PageComponent from './Page';

/*----------------------------------
- TYPES
----------------------------------*/

export type TProps = { service?: ClientRouter; loaderComponent?: React.ComponentType<{ isLoading: boolean }> };

/*----------------------------------
- COMPONENT
----------------------------------*/
export default function RouterComponent({ service: _clientRouter, loaderComponent: _loaderComponent }: TProps) {
    const context = useContext();
    const currentPage = context.page;

    if (!currentPage) return null;

    return (
        <PageComponent
            page={currentPage}
            key={currentPage.chunkId === undefined ? undefined : 'page_' + currentPage.chunkId}
        />
    );
}
