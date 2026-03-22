import { renderRows } from './layout';
import { renderTitle } from './ink';

export const renderDevSession = async ({
    appName,
    appRoot,
    routerPort,
    devEventPort,
}: {
    appName: string;
    appRoot: string;
    routerPort: number;
    devEventPort: number;
}) =>
    [
        await renderTitle('PROTEUM DEV', 'Watching source files and keeping the SSR server warm.'),
        renderRows(
            [
                { label: 'app', value: appName },
                { label: 'root', value: appRoot },
                { label: 'router', value: `http://localhost:${routerPort}` },
                { label: 'hmr', value: `http://localhost:${devEventPort}/__proteum_hmr` },
                { label: 'hotkeys', value: 'Ctrl+R reload, Ctrl+C stop' },
            ],
            { minLabelWidth: 12, maxLabelWidth: 12 },
        ),
    ].join('\n\n');
