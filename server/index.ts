import AppContainer from './app/container';
import Application from '@/server/index';
import { isServerHotReloadRequest, serverHotReloadMessageType } from '@common/dev/serverHotReload';

const application = AppContainer.start(Application);
let shutdownPromise: Promise<void> | undefined;

const shutdownApplication = async (reason: string) => {
    if (!shutdownPromise) {
        shutdownPromise = (async () => {
            try {
                console.info(`[server] Shutting down (${reason}) ...`);
                await application.runHook('cleanup');
            } catch (error) {
                console.error('[server] Failed to run application cleanup.', error);
                process.exit(1);
            }

            process.exit(0);
        })();
    }

    return shutdownPromise;
};

process.once('SIGINT', () => {
    void shutdownApplication('SIGINT');
});

process.once('SIGTERM', () => {
    void shutdownApplication('SIGTERM');
});

if (__DEV__ && typeof process.send === 'function') {
    process.on('message', (message: unknown) => {
        if (!isServerHotReloadRequest(message)) return;

        void (async () => {
            try {
                await application.Router?.started;
                await application.Router.reloadGeneratedDefinitions(message.changedFiles);

                process.send?.({ type: serverHotReloadMessageType.succeeded, changedFiles: message.changedFiles });
            } catch (error) {
                const errorMessage = error instanceof Error ? error.stack || error.message : String(error);

                process.send?.({
                    type: serverHotReloadMessageType.failed,
                    changedFiles: message.changedFiles,
                    error: errorMessage,
                });
            }
        })();
    });

    process.on('disconnect', () => {
        void shutdownApplication('parent disconnect');
    });
}
