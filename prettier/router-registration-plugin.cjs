const path = require('path');
const { createRequire } = require('module');

const requireFromWorkspace = createRequire(path.join(process.cwd(), 'package.json'));

const estreePlugin = (() => {
    try {
        return requireFromWorkspace('prettier/plugins/estree');
    } catch {
        return require('prettier/plugins/estree');
    }
})();

const basePrinter = estreePlugin.printers.estree;
const ROUTER_REGISTRATION_METHODS = new Set(['page', 'error']);

const isRouterRegistrationCall = (node) =>
    node?.type === 'CallExpression' &&
    node.callee?.type === 'MemberExpression' &&
    node.callee.object?.type === 'Identifier' &&
    node.callee.object.name === 'Router' &&
    node.callee.property?.type === 'Identifier' &&
    ROUTER_REGISTRATION_METHODS.has(node.callee.property.name);

const printRouterRegistrationCall = (path, print) => {
    const node = path.getValue();
    const parts = [path.call(print, 'callee'), '('];

    for (const [index] of node.arguments.entries()) {
        if (index > 0) parts.push(', ');
        parts.push(path.call(print, 'arguments', index));
    }

    parts.push(')');

    return parts;
};

module.exports = {
    printers: {
        estree: {
            ...basePrinter,
            print(path, options, print) {
                const node = path.getValue();

                if (isRouterRegistrationCall(node)) return printRouterRegistrationCall(path, print);

                return basePrinter.print(path, options, print);
            },
        },
    },
};
