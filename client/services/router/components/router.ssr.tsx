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
import PageLoading from './PageLoading';

/*----------------------------------
- TYPES
----------------------------------*/

export type TProps = { service?: ClientRouter; loaderComponent?: React.ComponentType<{ isLoading: boolean }> };

/*----------------------------------
- COMPONENT
----------------------------------*/
export default function RouterComponent({ service: _clientRouter, loaderComponent }: TProps) {
    const context = useContext();
    const currentPage = context.page;

    // Same tree as the client router: the page, then the idle loader.
    return (
        <>
            {currentPage && (
                <PageComponent
                    page={currentPage as Parameters<typeof PageComponent>[0]['page']}
                    key={currentPage.chunkId === undefined ? undefined : 'page_' + currentPage.chunkId}
                />
            )}

            <PageLoading loaderComponent={loaderComponent} />
        </>
    );
}
