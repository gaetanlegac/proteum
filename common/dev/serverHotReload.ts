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

export type TServerReadyMessage = {
    type: typeof serverHotReloadMessageType.ready;
    publicUrl: string;
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

export const isServerReadyMessage = (value: unknown): value is TServerReadyMessage =>
    typeof value === 'object' &&
    value !== null &&
    (value as TServerReadyMessage).type === serverHotReloadMessageType.ready &&
    typeof (value as TServerReadyMessage).publicUrl === 'string';
