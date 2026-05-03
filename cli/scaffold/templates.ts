import type { TScaffoldInitConfig, TScaffoldResult } from './types';

const renderJson = (value: unknown) => JSON.stringify(value, null, 4);

export type TTsconfigTemplatePaths = {
    frameworkTsconfig: string;
    frameworkClient: string;
    frameworkCommon: string;
    frameworkServer: string;
    frameworkTypesGlobal: string;
    preactCompat: string;
    preactCompatClient: string;
    preactTestUtils: string;
    preactJsxRuntime: string;
};

export const createPageTemplate = ({
    routePath,
    heading,
    message,
}: {
    routePath: string;
    heading: string;
    message: string;
}) => `import Router from '@/client/router';

Router.page(
    ${JSON.stringify(routePath)},
    {
        auth: false,
        layout: false,
    },
    () => ({
        heading: ${JSON.stringify(heading)},
        message: ${JSON.stringify(message)},
    }),
    ({ heading, message }) => {
        return (
            <main>
                <h1>{heading}</h1>
                <p>{message}</p>
            </main>
        );
    },
);
`;

export const createControllerTemplate = ({
    appIdentifier,
    className,
    methodName,
}: {
    appIdentifier: string;
    className: string;
    methodName: string;
}) => `import Controller from '@server/app/controller';

export default class ${className} extends Controller<${appIdentifier}> {
    public async ${methodName}() {
        return {
            ok: true,
        };
    }
}
`;

export const createCommandTemplate = ({
    className,
    methodName,
}: {
    className: string;
    methodName: string;
}) => `import { Commands } from '@server/app/commands';
import type App from '@/server/index';

export default class ${className} extends Commands<App> {
    public async ${methodName}() {
        return {
            ok: true,
            app: this.app.identity.identifier,
        };
    }
}
`;

export const createRouteTemplate = ({
    httpMethod,
    routePath,
}: {
    httpMethod: string;
    routePath: string;
}) => `import { Router } from '@app';

Router.${httpMethod}(${JSON.stringify(routePath)}, {}, async () => {
    return {
        ok: true,
    };
});
`;

export const createServiceTemplate = ({
    appIdentifier,
    className,
}: {
    appIdentifier: string;
    className: string;
}) => `import Service from '@server/app/service';

export type Config = {
    debug?: boolean;
};

export default class ${className} extends Service<Config, {}, ${appIdentifier}, ${appIdentifier}> {
    public async health() {
        return {
            ok: true,
        };
    }
}
`;

export const createServiceConfigTemplate = ({
    configExportName,
    serviceImportPath,
    serviceImportName,
}: {
    configExportName: string;
    serviceImportPath: string;
    serviceImportName: string;
}) => `import { Services } from '@server/app';
import ${serviceImportName} from ${JSON.stringify(serviceImportPath)};

export const ${configExportName} = Services.config(${serviceImportName}, {});
`;

export const createRouterConfigTemplate = () => `import { type ServiceConfig } from '@server/app';
import AppContainer from '@server/app/container';
import Router from '@server/services/router';

type RouterBaseConfig = Omit<ServiceConfig<typeof Router>, 'plugins'>;

const currentDomain = AppContainer.Environment.router.currentDomain;
const currentUrl = new URL(currentDomain);

export const routerBaseConfig = {
    currentDomain,
    http: {
        domain: currentUrl.hostname,
        port: AppContainer.Environment.router.port,
        ssl: currentUrl.protocol === 'https:',
        upload: {
            maxSize: '10mb',
        },
    },
    context: () => ({}),
} satisfies RouterBaseConfig;
`;

export const createServerIndexTemplate = ({ appIdentifier }: { appIdentifier: string }) => `import { Application } from '@server/app';
import Router from '@server/services/router';
import SchemaRouter from '@server/services/schema/router';

import * as appConfig from '@/server/config/app';

export default class ${appIdentifier} extends Application {
    public Router = new Router(
        this,
        {
            ...appConfig.routerBaseConfig,
            plugins: {
                schema: new SchemaRouter({}, this),
            },
        },
        this,
    );
}
`;

export const createClientTsconfigTemplate = (paths: TTsconfigTemplatePaths) => `{
    "extends": ${JSON.stringify(paths.frameworkTsconfig)},
    "compilerOptions": {
        "rootDir": "..",
        "baseUrl": "..",
        "noImplicitAny": true,
        "noImplicitThis": true,
        "strictBindCallApply": true,
        "useUnknownInCatchVariables": true,
        "paths": {
            "@client/*": [${JSON.stringify(paths.frameworkClient)}],
            "@common/*": [${JSON.stringify(paths.frameworkCommon)}],
            "@server/*": [${JSON.stringify(paths.frameworkServer)}],

            "@/client/context": ["./.proteum/client/context.ts"],
            "@generated/client/*": ["./.proteum/client/*"],
            "@generated/common/*": ["./.proteum/common/*"],
            "@generated/server/*": ["./.proteum/server/*"],
            "@/*": ["./*"],

            "react": [${JSON.stringify(paths.preactCompat)}],
            "react-dom/client": [${JSON.stringify(paths.preactCompatClient)}],
            "react-dom/test-utils": [${JSON.stringify(paths.preactTestUtils)}],
            "react-dom": [${JSON.stringify(paths.preactCompat)}],
            "react/jsx-runtime": [${JSON.stringify(paths.preactJsxRuntime)}]
        }
    },
    "include": [
        ".",
        "../var/typings",
        ${JSON.stringify(paths.frameworkTypesGlobal)},
        "../.proteum/client/services.d.ts"
    ]
}
`;

export const createServerTsconfigTemplate = (paths: TTsconfigTemplatePaths) => `{
    "extends": ${JSON.stringify(paths.frameworkTsconfig)},
    "compilerOptions": {
        "rootDir": "..",
        "baseUrl": "..",
        "noImplicitAny": true,
        "noImplicitThis": true,
        "strictBindCallApply": true,
        "useUnknownInCatchVariables": true,
        "moduleSuffixes": [".ssr", ""],
        "paths": {
            "@client/*": [${JSON.stringify(paths.frameworkClient)}],
            "@common/*": [${JSON.stringify(paths.frameworkCommon)}],
            "@server/*": [${JSON.stringify(paths.frameworkServer)}],

            "@/client/context": ["./.proteum/client/context.ts"],
            "@generated/client/*": ["./.proteum/client/*"],
            "@generated/common/*": ["./.proteum/common/*"],
            "@generated/server/*": ["./.proteum/server/*"],
            "@/*": ["./*"],

            "react": [${JSON.stringify(paths.preactCompat)}],
            "react-dom/client": [${JSON.stringify(paths.preactCompatClient)}],
            "react-dom/test-utils": [${JSON.stringify(paths.preactTestUtils)}],
            "react-dom": [${JSON.stringify(paths.preactCompat)}],
            "react/jsx-runtime": [${JSON.stringify(paths.preactJsxRuntime)}]
        }
    },
    "include": [
        ".",
        "../identity.config.ts",
        "../proteum.config.ts",
        "../var/typings",
        ${JSON.stringify(paths.frameworkTypesGlobal)},
        "../.proteum/server/services.d.ts",
        "../server/index.ts"
    ]
}
`;

export const createGitignoreTemplate = () => `node_modules
/.proteum
/.cache
/bin
/dev
/var
/proteum.connected.json
.env
`;

export const createEnvTemplate = ({ port, url }: { port: number; url: string }) => `ENV_NAME=local
ENV_PROFILE=dev
PORT=${port}
URL=${url}
URL_INTERNAL=${url}

# Optional trace settings
# TRACE_ENABLE=true
# TRACE_CAPTURE=resolve
# TRACE_PERSIST_ON_ERROR=true
`;

export const createEslintConfigTemplate = () => `import proteumEslint from 'proteum/eslint.js';

const { createProteumEslintConfig } = proteumEslint;

export default createProteumEslintConfig();
`;

export const createPackageJsonTemplate = ({
    packageName,
    appDescription,
    proteumDependency,
    preactDependency,
}: {
    packageName: string;
    appDescription: string;
    proteumDependency: string;
    preactDependency: string;
}) =>
    `${renderJson({
        name: packageName,
        version: '0.0.1',
        private: true,
        engines: {
            node: '>=20.19.0',
            npm: '>=3.10.10',
        },
        browserslist: ['>1%', 'not dead', 'not op_mini all'],
        scripts: {
            dev: 'NODE_ENV=development proteum dev',
            refresh: 'npx proteum refresh',
            typecheck: 'npx proteum typecheck',
            lint: 'npx proteum lint',
            check: 'npx proteum check',
            build: 'npx proteum build --prod',
            start: 'NODE_ENV=production node ./bin/server.js',
        },
        description: appDescription,
        dependencies: {
            preact: preactDependency,
            proteum: proteumDependency,
        },
    })}\n`;

export const createIdentityTemplate = ({
    appName,
    appIdentifier,
    appDescription,
}: {
    appName: string;
    appIdentifier: string;
    appDescription: string;
}) => `import { Application } from 'proteum/config';

export default Application.identity({
    name: ${JSON.stringify(appName)},
    identifier: ${JSON.stringify(appIdentifier)},
    description: ${JSON.stringify(appDescription)},
    author: {
        name: ${JSON.stringify(appName)},
        url: 'localhost',
        email: 'team@example.com',
    },
    social: {},
    language: 'en',
    locale: 'en-US',
    maincolor: 'white',
    iconsPack: 'light',
    web: {
        title: ${JSON.stringify(appName)},
        titleSuffix: ${JSON.stringify(appName)},
        fullTitle: ${JSON.stringify(appName)},
        description: ${JSON.stringify(appDescription)},
        version: '0.0.1',
    },
});
`;

export const createProteumConfigTemplate = () => `import { Application } from 'proteum/config';

export default Application.setup({
    transpile: [],
    connect: {},
});
`;

export const createInitSummary = (result: TScaffoldResult, config: TScaffoldInitConfig) => ({
    ...result,
    project: {
        directory: config.directory,
        name: config.name,
        identifier: config.identifier,
        port: config.port,
        url: config.url,
        proteumDependency: config.proteumDependency,
        install: config.install,
    },
});
