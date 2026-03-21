/*----------------------------------
- DEPENDANCES
----------------------------------*/

// Node
import { serialize } from "v8";
import { formatWithOptions } from "util";
import md5 from "md5";
import dayjs from "dayjs";
import Youch from "youch";
import forTerminal from "youch-terminal";

// Npm
import { v4 as uuid } from "uuid";
import { Logger, IMeta, ILogObj, ISettings } from "tslog";
import highlight from "cli-highlight";
import Ansi2Html from "ansi-to-html";

// Core libs
import type ApplicationContainer from "..";
import context from "@server/context";
import type { ServerBug, TCatchedError, CoreError } from "@common/errors";
import type ServerRequest from "@server/services/router/request";

/*----------------------------------
- SERVICE CONFIG
----------------------------------*/

export type TLogProfile = "silly" | "info" | "warn" | "error";

export type Config = {
  debug?: boolean;
  enable: boolean;
  bufferLimit: number;
  level: TLogProfile;
};

export type Hooks = {};

export type Services = {};

/*----------------------------------
- TYPES
----------------------------------*/

export type ChannelInfos = {
  channelType: "cron" | "master" | "request" | "socket";
  channelId?: string;

  method?: string;
  path?: string;

  user?: string;
};

export type TGuestLogs = {
  id: string;
  meet: Date;
  activity: Date;

  device: string;
  ip: string;
  user?: string;
};

export type TRequestLogs = {
  id: string;
  date: Date;

  method: string;
  url: string;
  data: TObjetDonnees;

  ip: string;
  user?: string;
  clientId: string;

  statusCode: number;
  time: number;
};

export type TDbQueryLog = ChannelInfos & {
  date: Date;
  query: string;
  time: number;
};

export type TLogLevel = keyof typeof logLevels;

export type TJsonLog = {
  time: Date;
  level: TLogLevel;
  args: unknown[];
  channel: ChannelInfos;
};

/*----------------------------------
- CONST
----------------------------------*/

const LogPrefix = "[console]";

const logLevels = {
  log: 0,
  info: 3,
  warn: 4,
  error: 5,
} as const;

var ansi2Html = new Ansi2Html({
  newline: true,
  // Material theme for Tilix
  // https://github.com/gnunn1/tilix/blob/master/data/schemes/material.json
  fg: "#fff",
  bg: "#000",
  colors: [
    "#252525",
    "#FF5252",
    "#C3D82C",
    "#FFC135",
    "#42A5F5",
    "#D81B60",
    "#00ACC1",
    "#F5F5F5",
    "#708284",
    "#FF5252",
    "#C3D82C",
    "#FFC135",
    "#42A5F5",
    "#D81B60",
    "#00ACC1",
    "#F5F5F5",
  ],
});

/*----------------------------------
- LOGGER
----------------------------------*/
export default class Console {
  // Services
  public logger!: Logger<ILogObj>;
  // Buffers
  public logs: TJsonLog[] = [];
  private reported: {
    [hash: string]: {
      times: number;
      last: Date;
    };
  } = {};

  /*----------------------------------
    - LIFECYCLE
    ----------------------------------*/
  /*
        WARN: This service should depend on the less services as possible, and be usable ASAP.
            So bug reports can be sent at any state of the app, includoing thre most early
    */
  public constructor(
    private container: typeof ApplicationContainer,
    private config: Config,
  ) {
    console.log("Setting up Console shell module.");

    const origLog = console.log;

    const Env = container.Environment;

    this.logger = new Logger({
      // Use to improve performance in production
      hideLogPositionForProduction: Env.profile === "prod",
      type: "pretty",
      prettyInspectOptions: {
        depth: 2,
      },
      overwrite: {
        formatMeta: (meta?: IMeta) => {
          // Shorten file paths
          if (meta?.path !== undefined) {
            meta.path.filePathWithLine = this.shortenFilePath(
              meta.path.filePathWithLine,
            );
          }

          return this.logger["_prettyFormatLogObjMeta"](meta);
        },
        transportFormatted: (
          logMetaMarkup: string,
          logArgs: unknown[],
          logErrors: string[],
          settings: ISettings<ILogObj>,
        ) => {
          try {
            const logErrorsStr =
              (logErrors.length > 0 && logArgs.length > 0 ? "\n" : "") +
              logErrors.join("\n");
            settings.prettyInspectOptions = settings.prettyInspectOptions || {};
            settings.prettyInspectOptions.colors = settings.stylePrettyLogs;
            origLog(
              logMetaMarkup +
                formatWithOptions(settings.prettyInspectOptions, ...logArgs) +
                logErrorsStr,
            );
          } catch (error) {
            origLog("Error formatting log", error);
          }
        },
      },
    });

    if (!this.config.enable || console["_wrapped"] !== undefined) return;

    this.enableLogging(origLog);
  }

  private enableLogging(origLog: typeof console.log) {
    const minLogLevel = logLevels[this.config.level];

    let logLevel: TLogLevel;
    for (logLevel in logLevels) {
      const levelNumber = logLevels[logLevel];
      console[logLevel] = (...args: any[]) => {
        // Dev mode = no care about performance = rich logging
        if (levelNumber >= minLogLevel)
          //this.logger[ logLevel ](...args);
          origLog(...args);
        // Prod mode = minimal logging

        const channel = this.getChannel();

        this.logs.push({
          time: new Date(),
          level: logLevel,
          args,
          channel,
        });
      };
    }

    console["_wrapped"] = true;

    setInterval(() => this.clean(), 10000);
  }

  /*----------------------------------
    - LOGS FORMATTING
    ----------------------------------*/

  public shortenFilePath(filepath?: string) {
    if (filepath === undefined) return undefined;

    const projectRoot = this.container.path.root;
    if (filepath.startsWith(projectRoot))
      filepath = filepath.substring(projectRoot.length);

    const frameworkRoot = "/node_modules/proteum/";
    if (filepath.startsWith(frameworkRoot))
      filepath = "@" + filepath.substring(frameworkRoot.length);

    return filepath;
  }

  /*----------------------------------
    - ACTIONS
    ----------------------------------*/

  public getLogLevelId(logLevelName: TLogLevel) {
    return logLevels[logLevelName];
  }

  private clean() {
    if (this.config.debug) {
      console.log(
        LogPrefix,
        `Clean logs buffer. Current size:`,
        this.logs.length,
        "/",
        this.config.bufferLimit,
        "Memory Size:",
        serialize(this.logs).byteLength,
      );
    }

    const bufferOverflow = this.logs.length - this.config.bufferLimit;
    if (bufferOverflow > 0) this.logs = this.logs.slice(bufferOverflow);
  }

  // We don't prevent duplicates because we want to receive all variants of the same error
  public async createBugReport(error: TCatchedError, request?: ServerRequest) {
    const application = this.container.application;
    if (application === undefined)
      return console.error(
        LogPrefix,
        "Can't send bug report because the application is not instanciated",
      );

    // Get context
    const now = new Date();
    const { channelType, channelId } = this.getChannel();

    // On envoi l'email avant l'insertion dans bla bdd
    // Car cette denrière a plus de chances de provoquer une erreur
    //const logs = this.logs.filter(e => e.channel.channelId === channelId).slice(-100);
    const inspection = this.getDetailledError(error);

    // Genertae unique error hash
    const hash = md5(inspection.stacktraces[0]);

    // Don't send the same error twice in a row (avoid email spamming)
    const lastReport = this.reported[hash];
    let isDuplicate = false;
    if (lastReport === undefined) {
      this.reported[hash] = {
        times: 0,
        last: new Date(),
      };

      // If error older than 1 day
    } else if (dayjs(now).diff(dayjs(lastReport.last), "day") > 1) {
      lastReport.times++;
      lastReport.last = now;
    } else {
      isDuplicate = true;
    }

    const bugReport: ServerBug = {
      // Context
      hash: hash,
      isDuplicate,
      date: now,
      channelType,
      channelId,

      ...(request
        ? {
            // User
            user: request.user,
            ip: request.ip,

            // Request
            request: {
              method: request.method,
              url: request.url,
              data: request.data,
              validatedData: request.validatedData,
              headers: request.headers,
              cookies: request.cookies,
            },
          }
        : {}),

      // Error
      title: inspection.title,
      stacktraces: inspection.stacktraces,
      context: inspection.context,
    };

    await application.runHook("bug", bugReport);

    return bugReport;
  }

  public getDetailledError(error: TCatchedError) {
    const stacktraces: string[] = [];
    const context: object[] = [];

    let currentError: TCatchedError | undefined = error;
    let title: string | undefined;
    while (currentError !== undefined) {
      if (title === undefined) title = currentError.message;

      // Stacktrace
      this.logger.error(
        LogPrefix,
        `Sending bug report for the following error:`,
        currentError,
      );
      stacktraces.push(currentError.stack || currentError.message);

      // Context
      if (
        "dataForDebugging" in currentError &&
        currentError.dataForDebugging !== undefined
      ) {
        console.error(
          LogPrefix,
          `More data about the error:`,
          currentError.dataForDebugging,
        );
        context.push(currentError.dataForDebugging || {});
      }

      // Go deeper
      currentError =
        "originalError" in currentError
          ? currentError.originalError
          : undefined;
    }

    return { title, stacktraces, context };
  }

  public getChannel() {
    return (
      context.getStore() || {
        channelType: "master",
        channelId: undefined,
      }
    );
  }

  /*----------------------------------
    - PRINT
    ----------------------------------*/

  public bugToHtml(report: ServerBug) {
    return `
<b>Channel</b>: ${report.channelType} (${report.channelId})<br />
<b>User</b>: ${report.user ? report.user.name + " (" + report.user.email + ")" : "Unknown"}<br />
<b>IP</b>: ${report.ip}<br />

${this.stacktracesToHTML(report.stacktraces)}

${report.context
  .map(
    (context, index) => `
    <hr />
    <b>Context ${index + 1}</b>: ${this.jsonToHTML(context)}<br />
`,
  )
  .join("")}

${
  report.request
    ? `
    <hr />
    <b>Request</b>: ${report.request.method} ${report.request.url}<br />
    <b>Headers</b>: ${this.jsonToHTML(report.request.headers)}<br />
    <b>Cookies</b>: ${this.jsonToHTML(report.request.cookies)}<br />
    <b>Raw Data</b>: ${this.jsonToHTML(report.request.data)}<br />
    <b>Validated Data</b>: ${this.jsonToHTML(report.request.validatedData)}
`
    : ""
}
<hr/>
Logs: ${this.config.enable ? `<br/>` + this.logsToHTML(report.logs) : "Logs collection is disabled"}<br />
        `;
  }

  public stacktracesToHTML(stacktraces: string[]): string {
    return stacktraces
      .map(
        (stacktrace, index) => `
            <hr />
            <b>Stacktrace ${index + 1}</b>: ${this.printHtml(stacktrace)}<br />
        `,
      )
      .join("");
  }

  public logsToHTML(logs: TJsonLog[]): string {
    let ansi = logs.map((logEntry) => this.logToAnsi(logEntry)).join("<br />");

    // Convert ANSI to HTML
    const html = ansi2Html.toHtml(ansi);

    return this.printHtml(html);
  }

  private logToAnsi(log: TJsonLog) {
    // Print metas as ANSI
    const logMetaMarkup = this.logger["_prettyFormatLogObjMeta"]({
      date: log.time,
      logLevelId: this.getLogLevelId(log.level),
      logLevelName: log.level,
      // We consider that having the path is useless in this case
      path: undefined,
    });

    // Print args as ANSI
    const logArgsAndErrorsMarkup = this.logger["runtime"].prettyFormatLogObj(
      log.args,
      this.logger.settings,
    );
    const logErrors = logArgsAndErrorsMarkup.errors;
    const logArgs = logArgsAndErrorsMarkup.args;
    const logErrorsStr =
      (logErrors.length > 0 && logArgs.length > 0 ? "\n" : "") +
      logErrors.join("\n");
    this.logger.settings.prettyInspectOptions.colors =
      this.logger.settings.stylePrettyLogs;
    let ansi =
      logMetaMarkup +
      formatWithOptions(this.logger.settings.prettyInspectOptions, ...logArgs) +
      logErrorsStr;

    return ansi;
  }

  public jsonToHTML(json: unknown): string {
    if (!json) return "No data";

    const coloredJson = highlight(JSON.stringify(json, null, 4), {
      language: "json",
      ignoreIllegals: true,
    });

    const html = ansi2Html.toHtml(coloredJson);

    return this.printHtml(html);
  }

  public printHtml(html: string): string {
    if (!html) return "No data";

    // Preserve spaces
    html = html
      .replace(/\t/g, "&nbsp;&nbsp;&nbsp;&nbsp;")
      .replace(/ /g, "&nbsp;")
      .replace(/\n/g, "<br />");

    // Create console wrapper
    const consoleCss = `background: #000; padding: 20px; font-family: 'Fira Mono', 'monospace', 'Monaco'; font-size: 12px; line-height: 20px;color: #aaa;`;
    html = '<div style="' + consoleCss + '">' + html + "</div>";

    return html;
  }

  public printSql = (requete: string) =>
    highlight(
      requete, //formatSql(requete, { indent: ' '.repeat(4) }),
      { language: "sql", ignoreIllegals: true },
    );

  /*public async getLogs( channelType: ChannelInfos["channelType"], channelId?: string ) {

        const filters: Partial<TDbQueryLog> = { channelType };
        if (channelId !== undefined)
            filters.channelId = channelId;

        const entries: TLog[] = []
        for (const log of this.logs) {

            // Filters
            if (!(log.channelId === channelId && log.channelType === channelType))
                continue;

            // Remove path prefixs
            if (log.filePath !== undefined) {

                const appPrefix = '/webpack:/' + this.app.pkg.name + '/';
                const appPrefixIndex = log.filePath.indexOf(appPrefix);
    
                const corePrefix = '/webpack:/' + this.app.pkg.name + '/node_modules/proteum/';
                const corePrefixIndex = log.filePath.indexOf(corePrefix);
    
                if (appPrefixIndex !== -1)
                    log.filePath = '@/' + log.filePath.substring(appPrefixIndex + appPrefix.length);
                else if (corePrefixIndex !== -1)
                    log.filePath = '@' + log.filePath.substring(corePrefixIndex + corePrefix.length);
            }
        }
        
        return this.printHtml( entries );
    }*/
}
