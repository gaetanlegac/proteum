const Module = require('node:module');
const path = require('node:path');

const coreRoot = path.join(__dirname, '..');
require('module-alias').addAliases({
    '@client': path.join(coreRoot, 'client'),
    '@common': path.join(coreRoot, 'common'),
    '@server': path.join(coreRoot, 'server'),
});
process.env.TS_NODE_PROJECT = path.join(coreRoot, 'cli', 'tsconfig.json');
process.env.TS_NODE_TRANSPILE_ONLY = '1';
require('ts-node/register/transpile-only');

const { createContext } = require('preact');

const ReactClientContext = createContext(undefined);
// What the default `useContext()` export returns: a test that mounts the router component sets it
const clientContext = { value: {} };
const stubs = {
    '@/client/context': Object.assign(() => clientContext.value, { ReactClientContext }),
    '@client/app/component': { default: () => null },
    '@client/pages/_layout': { default: () => null },
    '@generated/client/layouts': { default: {}, layoutOrder: [] },
    '@generated/client/routes': { default: {} },
    '@generated/common/controllers': { __esModule: true, default: () => ({}) },
    'react-dom': { hydrate: () => {} },
};

const originalLoad = Module._load;
Module._load = function load(request, parent, isMain) {
    if (request in stubs) return stubs[request];
    if (request === 'react') return originalLoad.call(this, 'preact/compat', parent, isMain);

    return originalLoad.call(this, request, parent, isMain);
};

const previous = { window: global.window, document: global.document, dev: global.__DEV__ };
global.__DEV__ = false;
global.window = {
    addEventListener: () => {},
    removeEventListener: () => {},
    history: { state: {}, pushState: () => {}, replaceState: () => {} },
    location: { hash: '', host: 'localhost', origin: 'http://localhost', pathname: '/', protocol: 'http:', search: '' },
    navigator: {},
    scrollTo: () => {},
};
global.document = { defaultView: global.window };

const ClientRouter = require('../client/services/router/index.tsx').default;

// A router instance without the app boot: tests set routes and config themselves
const createRouter = (config = {}) => {
    const app = { registerService: () => {}, handleUpdate: () => {} };
    return new ClientRouter(app, { preload: [], context: () => ({}), ...config });
};

const restore = () => {
    Module._load = originalLoad;
    for (const [key, value] of Object.entries(previous)) {
        const name = key === 'dev' ? '__DEV__' : key;
        if (value === undefined) delete global[name];
        else global[name] = value;
    }
};

const setClientContext = (value) => {
    clientContext.value = value;
};

module.exports = { ClientRouter, ReactClientContext, createRouter, restore, setClientContext };
