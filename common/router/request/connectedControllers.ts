/*----------------------------------
- DEPENDANCES
----------------------------------*/

import type ApiClient from './api';
import type { TFetcher, TPostDataWithFile } from './api';

/*----------------------------------
- TYPES
----------------------------------*/

/**
 * Leaves of a connected namespace whose HTTP path cannot be derived from their accessor, written out
 * by the generator. A function is a leaf; an object is a branch that may hold more of them.
 */
export type TConnectedControllerLiteralTree = { [key: string]: TConnectedControllerLiteralTree | ((data?: any) => TFetcher<any>) };

/*----------------------------------
- RULES
----------------------------------*/

/**
 * Keys a controller node answers with `undefined`, so the node never passes for a thenable (`await`,
 * `Promise.resolve`) or a JSON value (`JSON.stringify`). `arguments` and `caller` would throw on a function.
 */
const connectedControllerGuardedKeys = new Set(['then', 'toJSON', 'arguments', 'caller']);

/** Keys a node answers as the function it is (`toString`, `call`, `name`…), so logging or coercing one never calls a controller. */
const functionKeys = new Set(Object.getOwnPropertyNames(Function.prototype).filter((key) => !connectedControllerGuardedKeys.has(key)));

/** A connected accessor using one of these segments is not derivable: the generator writes it in the literal tree. */
export const connectedControllerReservedKeys = new Set([...connectedControllerGuardedKeys, ...functionKeys]);

/** The HTTP path a connected leaf answers on when nothing else is declared: `POST /api/<accessor with slashes>`. */
export const deriveConnectedControllerHttpPath = (controllerAccessor: string) =>
    '/api/' + controllerAccessor.split('.').join('/');

/** True when the generator may leave this leaf to the Proxy instead of writing it out. */
export const isDerivableConnectedController = (controllerAccessor: string, httpPath: string) =>
    httpPath === deriveConnectedControllerHttpPath(controllerAccessor) &&
    controllerAccessor.split('.').every((segment) => segment !== '' && !connectedControllerReservedKeys.has(segment));

/*----------------------------------
- NODE
----------------------------------*/

/**
 * One node of a connected project's client tree (`context.Product.Domains.Search(...)`).
 *
 * The generated client used to spell every connected leaf out (417 for the website, 84 KB of every
 * page's JS). A connected leaf is always `POST /api/<accessor with slashes>`, so the path is computed
 * when the leaf is called. Each property read returns the next node; a call builds the fetcher.
 * Leaves the generator could not derive come in `literal` and win over the computed path.
 */
export const createConnectedControllerNode = (
    api: Pick<ApiClient, 'createFetcher'>,
    namespace: string,
    literal?: TConnectedControllerLiteralTree,
    parts: string[] = [],
): any =>
    // An arrow function as the target: callable, and no own key a caller could enumerate or spread.
    new Proxy(() => undefined, {
        get: (target, key) => {
            if (typeof key !== 'string') return undefined;

            const written = literal && Object.prototype.hasOwnProperty.call(literal, key) ? literal[key] : undefined;
            if (typeof written === 'function') return written;
            if (written === undefined && connectedControllerGuardedKeys.has(key)) return undefined;
            if (written === undefined && functionKeys.has(key)) return Reflect.get(target, key);

            return createConnectedControllerNode(api, namespace, written, [...parts, key]);
        },
        apply: (_target, _self, args: unknown[]) => {
            const controllerAccessor = parts.join('.');
            const httpPath = deriveConnectedControllerHttpPath(controllerAccessor);

            return api.createFetcher('POST', httpPath, args[0] as TPostDataWithFile | undefined, {
                connected: { controllerAccessor, httpPath, namespace },
            });
        },
    });
