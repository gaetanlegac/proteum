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

export const isServerHotReloadRequest = (value: unknown): value is TServerHotReloadRequest =>
    typeof value === 'object' &&
    value !== null &&
    (value as TServerHotReloadRequest).type === serverHotReloadMessageType.request &&
    Array.isArray((value as TServerHotReloadRequest).changedFiles);

export const isServerHotReloadResult = (value: unknown): value is TServerHotReloadResult =>
    typeof value === 'object' &&
    value !== null &&
    ((value as TServerHotReloadResult).type === serverHotReloadMessageType.succeeded ||
        (value as TServerHotReloadResult).type === serverHotReloadMessageType.failed) &&
    Array.isArray((value as TServerHotReloadResult).changedFiles);

const isServerReadyConnectedProject = (value: unknown): value is TServerReadyConnectedProject =>
    typeof value === 'object' &&
    value !== null &&
    typeof (value as TServerReadyConnectedProject).namespace === 'string' &&
    typeof (value as TServerReadyConnectedProject).identifier === 'string' &&
    typeof (value as TServerReadyConnectedProject).name === 'string' &&
    typeof (value as TServerReadyConnectedProject).urlInternal === 'string' &&
    typeof (value as TServerReadyConnectedProject).healthUrl === 'string';

export const isServerReadyMessage = (value: unknown): value is TServerReadyMessage =>
    typeof value === 'object' &&
    value !== null &&
    (value as TServerReadyMessage).type === serverHotReloadMessageType.ready &&
    typeof (value as TServerReadyMessage).publicUrl === 'string' &&
    ((value as TServerReadyMessage).connectedProjects === undefined ||
        (Array.isArray((value as TServerReadyMessage).connectedProjects) &&
            (value as TServerReadyMessage).connectedProjects.every(isServerReadyConnectedProject)));
