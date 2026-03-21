export const serverHotReloadMessageType = {
  request: "proteum:router-reload",
  succeeded: "proteum:router-reload-succeeded",
  failed: "proteum:router-reload-failed",
} as const;

export type TServerHotReloadRequest = {
  type: typeof serverHotReloadMessageType.request;
  changedFiles: string[];
};

export type TServerHotReloadResult = {
  type:
    | typeof serverHotReloadMessageType.succeeded
    | typeof serverHotReloadMessageType.failed;
  changedFiles: string[];
  error?: string;
};

export const isServerHotReloadRequest = (
  value: unknown,
): value is TServerHotReloadRequest =>
  typeof value === "object" &&
  value !== null &&
  (value as TServerHotReloadRequest).type === serverHotReloadMessageType.request &&
  Array.isArray((value as TServerHotReloadRequest).changedFiles);

export const isServerHotReloadResult = (
  value: unknown,
): value is TServerHotReloadResult =>
  typeof value === "object" &&
  value !== null &&
  (((value as TServerHotReloadResult).type ===
    serverHotReloadMessageType.succeeded) ||
    ((value as TServerHotReloadResult).type ===
      serverHotReloadMessageType.failed)) &&
  Array.isArray((value as TServerHotReloadResult).changedFiles);
