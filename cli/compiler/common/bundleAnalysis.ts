import fs from 'fs-extra';
import path from 'path';
import type { RspackPluginInstance } from '@rspack/core';
import { UsageError } from 'clipanion';

import cli from '../..';
import type { App } from '../../app';

const { BundleAnalyzerPlugin } = require('webpack-bundle-analyzer');

export type TBundleAnalysisReportPaths = { reportPath: string; statsPath: string };
export type TBundleAnalysisMode = 'server' | 'static';
type TBundleAnalysisServerUrlArgs = {
    listenHost: string;
    listenPort: number | 'auto';
    boundAddress?: string | { address?: string; port?: number } | null;
};

const defaultAnalyzerHost = '127.0.0.1';
const defaultAnalyzerPort = 8888;
let latestClientBundleAnalysisServerUrl: string | undefined;

export const isBundleAnalysisEnabled = () => cli.args.analyze === true;
export const isBundleAnalysisServerEnabled = () => cli.args.analyzeServe === true;
export const getBundleAnalysisMode = (): TBundleAnalysisMode => (isBundleAnalysisServerEnabled() ? 'server' : 'static');

const hasCliStringArg = (name: string) => typeof cli.args[name] === 'string' && (cli.args[name] as string).trim().length > 0;

export const hasBundleAnalysisServerOverrides = () => hasCliStringArg('analyzeHost') || hasCliStringArg('analyzePort');

export const getBundleAnalysisServerHost = () =>
    hasCliStringArg('analyzeHost') ? String(cli.args.analyzeHost).trim() : defaultAnalyzerHost;

export const getBundleAnalysisServerPort = (): number | 'auto' => {
    const rawPort = hasCliStringArg('analyzePort') ? String(cli.args.analyzePort).trim() : '';
    if (!rawPort) return defaultAnalyzerPort;
    if (rawPort === 'auto') return 'auto';

    const parsedPort = Number.parseInt(rawPort, 10);
    if (!Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65535) {
        throw new UsageError(`Invalid analyzer port "${rawPort}". Use a number between 1 and 65535, or \`auto\`.`);
    }

    return parsedPort;
};

const createBundleAnalysisServerUrl = ({ listenHost, listenPort, boundAddress }: TBundleAnalysisServerUrlArgs) => {
    const port =
        typeof boundAddress === 'object' && boundAddress !== null && typeof boundAddress.port === 'number'
            ? boundAddress.port
            : listenPort;
    const url = `http://${listenHost}:${port}`;
    latestClientBundleAnalysisServerUrl = url;
    return url;
};

export const consumeClientBundleAnalysisServerUrl = () => {
    const url = latestClientBundleAnalysisServerUrl;
    latestClientBundleAnalysisServerUrl = undefined;
    return url;
};

export const getClientBundleAnalysisReportPaths = (
    app: App,
    outputTarget: 'dev' | 'bin',
): TBundleAnalysisReportPaths => {
    const reportDir = path.join(app.outputPath(outputTarget), 'bundle-analysis');

    return { reportPath: path.join(reportDir, 'client.html'), statsPath: path.join(reportDir, 'client-stats.json') };
};

export const createClientBundleAnalysisPlugins = (app: App, outputTarget: 'dev' | 'bin'): RspackPluginInstance[] => {
    if (!isBundleAnalysisEnabled()) return [];

    latestClientBundleAnalysisServerUrl = undefined;

    const { reportPath, statsPath } = getClientBundleAnalysisReportPaths(app, outputTarget);
    const analyzerMode = getBundleAnalysisMode();

    fs.ensureDirSync(path.dirname(reportPath));

    return [
        new BundleAnalyzerPlugin({
            analyzerMode,
            analyzerHost: getBundleAnalysisServerHost(),
            analyzerPort: getBundleAnalysisServerPort(),
            openAnalyzer: false,
            defaultSizes: 'parsed',
            reportFilename: reportPath,
            generateStatsFile: true,
            statsFilename: statsPath,
            logLevel: 'info',
            analyzerUrl: createBundleAnalysisServerUrl,
        }),
    ];
};

const sleep = (delayMs: number) => new Promise((resolve) => setTimeout(resolve, delayMs));

const isJsonFileComplete = (filepath: string) => {
    const fd = fs.openSync(filepath, 'r');

    try {
        const { size } = fs.fstatSync(fd);
        if (size === 0) return false;

        const readLength = Math.min(512, size);
        const buffer = Buffer.alloc(readLength);
        fs.readSync(fd, buffer, 0, readLength, size - readLength);

        const tail = buffer.toString('utf8').trimEnd();
        if (!tail.endsWith('}')) return false;

        JSON.parse(fs.readFileSync(filepath, 'utf8'));
        return true;
    } catch {
        return false;
    } finally {
        fs.closeSync(fd);
    }
};

export const waitForClientBundleAnalysisArtifacts = async (
    app: App,
    outputTarget: 'dev' | 'bin',
    timeoutMs: number = 30000,
) => {
    const startedAt = Date.now();
    const { reportPath, statsPath } = getClientBundleAnalysisReportPaths(app, outputTarget);
    let previousStatsSize = -1;

    while (Date.now() - startedAt < timeoutMs) {
        const reportExists = fs.existsSync(reportPath);
        const statsExists = fs.existsSync(statsPath);

        if (reportExists && statsExists) {
            const { size } = fs.statSync(statsPath);
            const sizeStable = size > 0 && size === previousStatsSize;

            if (sizeStable && isJsonFileComplete(statsPath)) return;

            previousStatsSize = size;
        }

        await sleep(250);
    }

    throw new Error(`Timed out waiting for bundle analysis artifacts to complete: ${reportPath}, ${statsPath}`);
};
