/*----------------------------------
- DEPENDANCES
----------------------------------*/

// Core

import { fromJson as errorFromJson } from '@common/errors';
import {
    profilerOriginHeader,
    profilerParentRequestIdHeader,
    profilerSessionIdHeader,
} from '@common/dev/profiler';
import RequestService from './service';

import ApiClientService, {
    TFetcherList,
    TFetcherArgs,
    TFetcher,
    TDataReturnedByFetchers,
} from '@common/router/request/api';

/*----------------------------------
- TYPES
----------------------------------*/

/*----------------------------------
- SERVICE
----------------------------------*/
export default class ApiClientRequest extends RequestService implements ApiClientService {
    private isApiFetcher(fetcher: TFetcher | Promise<unknown>): fetcher is TFetcher {
        return typeof fetcher === 'object' && fetcher !== null && 'method' in fetcher && 'path' in fetcher;
    }

    private toTraceInspectable(data: unknown) {
        if (data === null || data === undefined) return data;
        if (typeof data === 'string' || typeof data === 'number' || typeof data === 'boolean') return data;
        if (typeof data === 'bigint' || typeof data === 'symbol' || typeof data === 'function') return data;
        if (typeof data === 'object') return data;

        return undefined;
    }

    private getTraceCallOrigin() {
        return this.request.path === '/api' ? 'api-batch-fetcher' as const : 'ssr-fetcher' as const;
    }

    private createTraceCall({
        fetcherId,
        method,
        path,
        data,
        options,
    }: {
        fetcherId: string;
        method: string;
        path: string;
        data: unknown;
        options?: TFetcher['options'];
    }) {
        return this.request.router.app.container.Trace.startCall(this.request.id, {
            origin: this.getTraceCallOrigin(),
            label: fetcherId,
            method,
            path,
            fetcherId,
            ...(options?.connected
                ? {
                      connectedControllerAccessor: options.connected.controllerAccessor,
                      connectedProjectNamespace: options.connected.namespace,
                  }
                : {}),
            requestDataKeys: data && typeof data === 'object' ? Object.keys(data as Record<string, unknown>) : [],
            requestData: this.toTraceInspectable(data),
        });
    }

    private buildConnectedRequestHeaders(fetcher: TFetcher) {
        const headers = new Headers();

        for (const [key, value] of Object.entries(this.request.headers)) {
            if (!value) continue;
            if (key === 'content-length' || key === 'host') continue;
            headers.set(key, value);
        }

        headers.set('accept', 'application/json');

        if (fetcher.options?.connected) {
            headers.set(profilerOriginHeader, this.getTraceCallOrigin());

            const profilerSessionId = this.request.headers[profilerSessionIdHeader];
            if (profilerSessionId) headers.set(profilerSessionIdHeader, profilerSessionId);
            headers.set(profilerParentRequestIdHeader, this.request.id);
        }

        return headers;
    }

    private async resolveConnectedFetcher<TData>(fetcher: TFetcher<TData>) {
        const connected = fetcher.options?.connected;
        if (!connected) throw new Error('Connected fetcher metadata is missing.');

        const connectedProject = this.request.router.app.connectedProjects?.[connected.namespace];
        if (!connectedProject) {
            throw new Error(`Connected project "${connected.namespace}" is not registered on ${this.request.router.app.identity.identifier}.`);
        }

        const headers = this.buildConnectedRequestHeaders(fetcher);
        const url = new URL(fetcher.path, connectedProject.urlInternal).toString();
        const init: RequestInit = {
            method: fetcher.method,
            headers,
        };

        if (fetcher.data) {
            if (fetcher.method === 'GET') {
                const params = new URLSearchParams();
                for (const [key, value] of Object.entries(fetcher.data)) {
                    if (value === undefined || value === null) continue;
                    params.set(key, String(value));
                }

                return this.fetchConnectedResponse<TData>(`${url}?${params.toString()}`, init);
            }

            headers.set('content-type', 'application/json');
            init.body = JSON.stringify(fetcher.data);
        }

        return this.fetchConnectedResponse<TData>(url, init);
    }

    private async fetchConnectedResponse<TData>(url: string, init: RequestInit) {
        const response = await fetch(url, init);

        if (!response.ok) {
            const contentType = response.headers.get('content-type') || '';
            const errorPayload = contentType.includes('application/json') ? await response.json() : await response.text();
            const typedError =
                typeof errorPayload === 'object' && errorPayload && 'code' in (errorPayload as object)
                    ? (errorFromJson(errorPayload as any) as Error & { http?: number })
                    : (new Error(typeof errorPayload === 'string' ? errorPayload : `Connected request failed with ${response.status}.`) as Error & {
                          http?: number;
                      });
            typedError.http = response.status;
            throw typedError;
        }

        return (await response.json()) as TData;
    }

    /*----------------------------------
    - HIGH LEVEL
    ----------------------------------*/

    public fetch<TProvidedData extends TFetcherList = TFetcherList>(
        _fetchers: TFetcherList,
    ): TDataReturnedByFetchers<TProvidedData> {
        throw new Error("api.fetch shouldn't be called here.");
    }

    /*----------------------------------
    - PLACEHOLDERS
    ----------------------------------*/

    public set(_newData: TObjetDonnees) {
        throw new Error('api.set is not available on server side.');
    }

    public reload(_ids?: string | string[], _params?: TObjetDonnees) {
        throw new Error('api.set is not available on server side.');
    }

    /*----------------------------------
    - API CALLS FROM SERVER
    ----------------------------------*/

    public createFetcher<TData extends unknown = unknown>(
        ...[method, path, data, options]: TFetcherArgs
    ): TFetcher<TData> {
        return {
            method,
            path,
            data,
            options,
            // We don't put the then and catch methods so the api consumer on server side will know it's a fetcher and not a promize to wait
        } as TFetcher<TData>;
    }

    public async fetchSync(fetchers: TFetcherList, alreadyLoadedData: {}): Promise<TObjetDonnees> {
        const fetchedData: TObjetDonnees = { ...alreadyLoadedData };

        for (const id in fetchers) {
            const fetcher = fetchers[id];
            if (!fetcher) continue;

            // Promise Fetcher (direct call from service method)
            if (!this.isApiFetcher(fetcher)) {
                fetchedData[id] = await fetcher;
                continue;
            }

            const { method, path, data, options } = fetcher;
            //this.router.config.debug && console.log(`[api] Resolving from internal api`, method, path, data);

            // We don't fetch the already given data
            if (id in fetchedData) continue;

            const callId = this.createTraceCall({ data, fetcherId: id, method, options, path });

            try {
                if (options?.connected) {
                    fetchedData[id] = await this.resolveConnectedFetcher(fetcher);
                } else {
                    const request = this.request.children(method, path, data);
                    if (callId)
                        request.traceCall = {
                            fetcherId: id,
                            id: callId,
                            label: id,
                            origin: this.getTraceCallOrigin(),
                        };

                    const response = await request.router.resolve(request);
                    fetchedData[id] = response.data;
                    this.request.router.app.container.Trace.finishCall(this.request.id, callId, {
                        statusCode: response.statusCode,
                        resultKeys:
                            response.data && typeof response.data === 'object' && !Array.isArray(response.data)
                                ? Object.keys(response.data as Record<string, unknown>)
                                : [],
                        result: response.data as object | string | number | boolean | bigint | symbol | null | undefined,
                    });
                    continue;
                }

                this.request.router.app.container.Trace.finishCall(this.request.id, callId, {
                    statusCode: 200,
                    resultKeys:
                        fetchedData[id] && typeof fetchedData[id] === 'object' && !Array.isArray(fetchedData[id])
                            ? Object.keys(fetchedData[id] as Record<string, unknown>)
                            : [],
                    result: fetchedData[id] as object | string | number | boolean | bigint | symbol | null | undefined,
                });
            } catch (error) {
                const typedError = error instanceof Error ? error : new Error(typeof error === 'string' ? error : 'Unknown error');
                const statusCode = 'http' in typedError ? Number((typedError as Error & { http?: number }).http) : undefined;
                this.request.router.app.container.Trace.finishCall(this.request.id, callId, {
                    statusCode: Number.isFinite(statusCode) ? statusCode : undefined,
                    errorMessage: typedError.message,
                });
                throw error;
            }
        }

        return fetchedData;
    }
}
