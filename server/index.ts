import AppContainer from "./app/container";
import Application from "@/server/.generated/app";
import {
  isServerHotReloadRequest,
  serverHotReloadMessageType,
} from "@common/dev/serverHotReload";

const application = AppContainer.start(Application);

if (__DEV__ && typeof process.send === "function") {
  process.on("message", (message: unknown) => {
    if (!isServerHotReloadRequest(message)) return;

    void (async () => {
      try {
        await application.Router?.started;
        await application.Router.reloadGeneratedDefinitions(message.changedFiles);

        process.send?.({
          type: serverHotReloadMessageType.succeeded,
          changedFiles: message.changedFiles,
        });
      } catch (error) {
        const errorMessage =
          error instanceof Error
            ? error.stack || error.message
            : String(error);

        process.send?.({
          type: serverHotReloadMessageType.failed,
          changedFiles: message.changedFiles,
          error: errorMessage,
        });
      }
    })();
  });
}
