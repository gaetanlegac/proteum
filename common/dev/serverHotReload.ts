export const serverHotReloadMessageType = {
    request: 'proteum:router-reload',
    succeeded: 'proteum:router-reload-succeeded',
    failed: 'proteum:router-reload-failed',
    ready: 'proteum:server-ready',
} as const;

export type TServerHotReloadRequest = { type: typeof serverHotReloadMessageType.request; changedFiles: string[] };

export type TServerHotReloadResult = {
    type: typeof serverHotReloadMessageType.succeeded | typeof serverHotReloadMessageType.failed;
    changedFiles: string[];
    error?: string;
};

export type TServerReadyConnectedProject = {
    namespace: string;
    identifier: string;
    name: string;
    urlInternal: string;
    healthUrl: string;
};

export type TServerReadyMessage = {
    type: typeof serverHotReloadMessageType.ready;
    publicUrl: string;
    connectedProjects?: TServerReadyConnectedProject[];
};

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

export const isServerHotReloadRequest = (value: unknown): value is TServerHotReloadRequest =>
    isRecord(value) &&
    value.type === serverHotReloadMessageType.request &&
    Array.isArray(value.changedFiles);

export const isServerHotReloadResult = (value: unknown): value is TServerHotReloadResult =>
    isRecord(value) &&
    (value.type === serverHotReloadMessageType.succeeded || value.type === serverHotReloadMessageType.failed) &&
    Array.isArray(value.changedFiles);

const isServerReadyConnectedProject = (value: unknown): value is TServerReadyConnectedProject =>
    isRecord(value) &&
    typeof value.namespace === 'string' &&
    typeof value.identifier === 'string' &&
    typeof value.name === 'string' &&
    typeof value.urlInternal === 'string' &&
    typeof value.healthUrl === 'string';

export const isServerReadyMessage = (value: unknown): value is TServerReadyMessage => {
    if (!isRecord(value)) return false;

    const connectedProjects = value.connectedProjects;
    return (
        value.type === serverHotReloadMessageType.ready &&
        typeof value.publicUrl === 'string' &&
        (connectedProjects === undefined ||
            (Array.isArray(connectedProjects) && connectedProjects.every(isServerReadyConnectedProject)))
    );
};
