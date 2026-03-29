/*----------------------------------
- DEPENDANCES
----------------------------------*/

// Core
import type ClientApplication from '@client/app';
import { buildConnectedProjectProxyPath } from '@common/connectedProjects';
import { fromJson as errorFromJson, NetworkError } from '@common/errors';
import ApiClientService, {
    TPostData,
    TPostDataWithoutFile,
    TApiFetchOptions,
    TFetcherList,
    TFetcherArgs,
    TFetcher,
    TDataReturnedByFetchers,
} from '@common/router/request/api';

// Specific
import type { default as Router, Request } from '..';
import { toMultipart } from './multipart';

/*----------------------------------
- TYPES
----------------------------------*/

const debug = false;
const getProfilerModule = () => {
    if (!__DEV__) return undefined;
    return require('@client/dev/profiler/runtime') as typeof import('@client/dev/profiler/runtime');
};
const withProfiler = <T>(callback: (runtime: (typeof import('@client/dev/profiler/runtime'))['profilerRuntime']) => T) => {
    const profilerModule = getProfilerModule();
    return profilerModule ? callback(profilerModule.profilerRuntime) : undefined;
};

type TExecuteResult<TData> = { data: TData; durationMs: number; response: Response };

export type Config = {};

const isFileValue = (value: unknown): value is File =>
    typeof File !== 'undefined' && typeof value === 'object' && value instanceof File;

/*----------------------------------
- FUNCTION
----------------------------------*/
export default class ApiClient implements ApiClientService {
    // APO Client needs to know the current request so we can monitor which api request is made from which page
    public constructor(
        public app: ClientApplication,
        public request: Request,
        public router = request.router,
    ) {}

    /*----------------------------------
    - HIGH LEVEL
    ----------------------------------*/

    public fetch<FetchersList extends TFetcherList = TFetcherList>(
        fetchers: FetchersList,
    ): TDataReturnedByFetchers<FetchersList> {
        throw new Error("api.fetch shouldn't be called here.");
    }

    public post = <TData extends unknown = unknown>(path: string, data?: TPostData, opts?: TApiFetchOptions) =>
        this.createFetcher<TData>('POST', path, data, opts);

    public set(newData: TObjetDonnees) {
        if (!('context' in this.router)) throw new Error('api.set is not available on server side.');

        const currentPage = this.router.context.page;
        if (currentPage && 'setAllData' in currentPage) {
            const page = currentPage as { setAllData: (updater: (data: TObjetDonnees) => TObjetDonnees) => void };
            page.setAllData((curData) => ({ ...curData, ...newData }));
        }
        else throw new Error(`[api] this.router.context.page undefined`);
    }

    public reload(ids?: string | string[], params?: TObjetDonnees) {
        if (!('context' in this.router)) throw new Error('api.reload is not available on server side.');

        const page = this.router.context.page;
        if (!page) throw new Error('api.reload requires an active page context.');

        if (ids === undefined) ids = Object.keys(page.fetchers);
        else if (typeof ids === 'string') ids = [ids];

        if (params !== undefined) page.context.request.data = { ...page.context.request.data, ...params };

        const nextData = { ...page.data };
        for (const id of ids) delete nextData[id];

        page.data = nextData;

        debug && console.log('[api] Reload data', ids, params, page.fetchers);

        page.fetchData()
            .then((data: TObjetDonnees) => {
                this.set(data);
            })
            .catch((error: Error) => {
                this.app.handleError(error);
            });
    }

    /*----------------------------------
    - LOW LEVEL
    ----------------------------------*/
    public createFetcher<TData extends unknown = unknown>(...args: TFetcherArgs): TFetcher<TData> {
        const [method, path, data, options] = args;

        // Lazily create (and cache) the underlying promise so the fetcher behaves like a real promise instance.
        let promise: Promise<TData> | undefined;

        const fetcher = { method, path, data, options } as TFetcher<TData>;

        const getPromise = () => {
            if (!promise) promise = this.fetchAsync<TData>(fetcher.method, fetcher.path, fetcher.data, fetcher.options);

            return promise;
        };

        // For async calls: api.post(...).then((data) => ...)
        fetcher.then = (onfulfilled?: any, onrejected?: any) => getPromise().then(onfulfilled, onrejected) as any;

        fetcher.catch = (onrejected?: any) => getPromise().catch(onrejected) as any;

        fetcher.finally = (onfinally?: any) => getPromise().finally(onfinally) as any;

        fetcher.run = () => getPromise();

        return fetcher;
    }

    public async fetchAsync<TData extends unknown = unknown>(
        ...[method, path, data, options]: TFetcherArgs
    ): Promise<TData> {
        /*if (options?.captcha !== undefined)
            await this.gui.captcha.check(options?.captcha);*/
        const pendingTrace = withProfiler((runtime) =>
            runtime.startTrace('async', {
                label: `${method} ${path}`,
                method,
                path,
            }),
        );

        try {
            const result = await this.executeDetailed<TData>('client-async', method, path, data, options);
            const profilerModule = getProfilerModule();
            const traceRequestId = profilerModule?.readProfilerTraceRequestId(result.response);

            if (pendingTrace && traceRequestId) {
                await profilerModule?.profilerRuntime.attachTraceByRequestId(
                    pendingTrace.sessionId,
                    pendingTrace.traceId,
                    traceRequestId,
                );
            } else if (pendingTrace) {
                withProfiler((runtime) =>
                    runtime.completeTrace(pendingTrace.traceId, {
                        durationMs: result.durationMs,
                        status: 'completed',
                    }),
                );
            }

            return result.data;
        } catch (error) {
            const profilerModule = getProfilerModule();
            const errorResponse = (error as Error & { response?: Response }).response;
            const traceRequestId = errorResponse ? profilerModule?.readProfilerTraceRequestId(errorResponse) : undefined;
            if (pendingTrace && traceRequestId) {
                await profilerModule?.profilerRuntime.attachTraceByRequestId(
                    pendingTrace.sessionId,
                    pendingTrace.traceId,
                    traceRequestId,
                );
            }
            withProfiler((runtime) =>
                runtime.completeTrace(pendingTrace?.traceId, {
                    errorMessage: error instanceof Error ? error.message : String(error),
                    status: 'error',
                }),
            );
            throw error;
        }
    }

    public async fetchSync(fetchers: TFetcherList, alreadyLoadedData: {}): Promise<TObjetDonnees> {
        // Pick the fetchers where the data is needed
        const fetchersToRun: TFetcherList = {};
        let fetchersCount: number = 0;
        // The fetcher can be undefined
        for (const fetcherId in fetchers)
            if (!(fetcherId in alreadyLoadedData) && fetchers[fetcherId]) {
                fetchersToRun[fetcherId] = fetchers[fetcherId];
                fetchersCount++;
            }

        // Fetch all the api data thanks to one http request
        const fetchedData =
            fetchersCount === 0
                ? {}
                : await (async () => {
                      const pendingTrace = withProfiler((runtime) =>
                          runtime.startTrace('navigation-data', {
                              fetcherIds: Object.keys(fetchersToRun),
                              label: 'Navigation data',
                              method: 'POST',
                              path: '/api',
                          }),
                      );

                      try {
                          const result = await this.executeDetailed<TObjetDonnees>(
                              'client-navigation',
                              'POST',
                              '/api',
                              ({ fetchers: fetchersToRun } as unknown) as TPostData,
                          );
                          const profilerModule = getProfilerModule();
                          const traceRequestId = profilerModule?.readProfilerTraceRequestId(result.response);

                          if (pendingTrace && traceRequestId) {
                              await profilerModule?.profilerRuntime.attachTraceByRequestId(
                                  pendingTrace.sessionId,
                                  pendingTrace.traceId,
                                  traceRequestId,
                              );
                          } else if (pendingTrace) {
                              withProfiler((runtime) =>
                                  runtime.completeTrace(pendingTrace.traceId, {
                                      durationMs: result.durationMs,
                                      status: 'completed',
                                  }),
                              );
                          }

                          const responseData: TObjetDonnees = {};
                          for (const id in result.data) responseData[id] = result.data[id];
                          return responseData;
                      } catch (e) {
                          const profilerModule = getProfilerModule();
                          const errorResponse = (e as Error & { response?: Response }).response;
                          const traceRequestId = errorResponse ? profilerModule?.readProfilerTraceRequestId(errorResponse) : undefined;
                          if (pendingTrace && traceRequestId) {
                              await profilerModule?.profilerRuntime.attachTraceByRequestId(
                                  pendingTrace.sessionId,
                                  pendingTrace.traceId,
                                  traceRequestId,
                              );
                          }
                          withProfiler((runtime) =>
                              runtime.completeTrace(pendingTrace?.traceId, {
                                  errorMessage: e instanceof Error ? e.message : String(e),
                                  status: 'error',
                              }),
                          );

                          // API Error hook
                          this.app.handleError(e as Error);

                          throw e;
                      }
                  })();

        // Errors will be catched in the caller

        return { ...alreadyLoadedData, ...fetchedData };
    }

    public configure = (...[method, path, data, options = {}]: TFetcherArgs) => {
        const requestPath =
            options.connected !== undefined
                ? buildConnectedProjectProxyPath(options.connected.namespace, path)
                : path;
        let url = this.router.url(requestPath, {}, false);

        debug && console.log(`[api] Sending request`, method, url, data);

        // Create Fetch config
        const headers = new Headers({ Accept: 'application/json' });
        const config: RequestInit = { method, headers };

        // Update options depending on data
        if (data) {
            // If file included in data, need to use multipart
            // TODO: deep check
                const hasFile = Object.values(data).some((value) => isFileValue(value));
            if (hasFile) {
                // GET request = Can't send files
                if (method === 'GET') throw new Error('Cannot send file in GET request');
                // Auto switch to multiplart
                else if (options.encoding === undefined) options.encoding = 'multipart';
                else if (options.encoding !== 'multipart')
                    // Encoding set to JSON = Can't send files
                    throw new Error('Cannot send file in non-multipart request');
            }

            // Data encoding
            if (method === 'GET') {
                const params = new URLSearchParams();
                for (const [key, value] of Object.entries(data as TPostDataWithoutFile)) {
                    if (value === undefined || value === null) continue;
                    params.set(key, String(value));
                }
                url = `${url}?${params}`;
            } else if (options.encoding === 'multipart') {
                debug && console.log('[api] Multipart request', data);
                // Browser will automatically choose the right headers
                config.body = toMultipart(data);
            } else {
                headers.set('Content-Type', 'application/json');
                config.body = JSON.stringify(data);
            }
        }

        return { url, config };
    };

    public execute<TData = unknown>(...args: TFetcherArgs): Promise<TData> {
        return this.executeDetailed<TData>('client-async', ...args).then((result) => result.data);
    }

    private async executeDetailed<TData = unknown>(
        profilerOrigin: string,
        ...args: TFetcherArgs
    ): Promise<TExecuteResult<TData>> {
        const { url, config } = this.configure(...args);
        const startedAt = Date.now();
        const headers = config.headers instanceof Headers ? config.headers : new Headers(config.headers as HeadersInit);
        const profilerHeaders = withProfiler((runtime) => runtime.getRequestHeaders(profilerOrigin)) || {};
        for (const [key, value] of Object.entries(profilerHeaders)) headers.set(key, value);
        config.headers = headers;

        console.log(`[api] Fetching`, url, config);

        return fetch(url, config)
            .then(async (response) => {
                const requestDurationMs = Math.max(0, Date.now() - startedAt);
                if (!response.ok) {
                    const errorData = await response.json();
                    console.warn(`[api] Failure:`, response.status, errorData);
                    const error = errorFromJson(errorData) as Error & { durationMs?: number; response?: Response };
                    error.durationMs = requestDurationMs;
                    error.response = response;
                    throw error;
                }
                const json = (await response.json()) as TData;
                debug && console.log(`[api] Success:`, json);
                return { data: json, durationMs: requestDurationMs, response };
            })
            .catch((error) => {
                if (error instanceof TypeError) {
                    // Network error
                    console.warn(`[api] Network Failure:`, error);
                    const networkError = new NetworkError(error.message);
                    this.app.handleError(networkError);
                    throw networkError;
                } else {
                    throw error;
                }
            });
    }
}
