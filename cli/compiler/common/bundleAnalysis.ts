import fs from "fs-extra";
import path from "path";
import type { RspackPluginInstance } from "@rspack/core";

import cli from "../..";
import type { App } from "../../app";

const { BundleAnalyzerPlugin } = require("webpack-bundle-analyzer");

export type TBundleAnalysisReportPaths = {
  reportPath: string;
  statsPath: string;
};

export const isBundleAnalysisEnabled = () => cli.args.analyze === true;

export const getClientBundleAnalysisReportPaths = (
  app: App,
  outputTarget: "dev" | "bin",
): TBundleAnalysisReportPaths => {
  const reportDir = path.join(app.outputPath(outputTarget), "bundle-analysis");

  return {
    reportPath: path.join(reportDir, "client.html"),
    statsPath: path.join(reportDir, "client-stats.json"),
  };
};

export const createClientBundleAnalysisPlugins = (
  app: App,
  outputTarget: "dev" | "bin",
): RspackPluginInstance[] => {
  if (!isBundleAnalysisEnabled()) return [];

  const { reportPath, statsPath } = getClientBundleAnalysisReportPaths(
    app,
    outputTarget,
  );

  fs.ensureDirSync(path.dirname(reportPath));

  return [
    new BundleAnalyzerPlugin({
      analyzerMode: "static",
      openAnalyzer: false,
      defaultSizes: "parsed",
      reportFilename: reportPath,
      generateStatsFile: true,
      statsFilename: statsPath,
      logLevel: "info",
    }),
  ];
};

const sleep = (delayMs: number) =>
  new Promise((resolve) => setTimeout(resolve, delayMs));

const isJsonFileComplete = (filepath: string) => {
  const fd = fs.openSync(filepath, "r");

  try {
    const { size } = fs.fstatSync(fd);
    if (size === 0) return false;

    const readLength = Math.min(512, size);
    const buffer = Buffer.alloc(readLength);
    fs.readSync(fd, buffer, 0, readLength, size - readLength);

    const tail = buffer.toString("utf8").trimEnd();
    if (!tail.endsWith("}")) return false;

    JSON.parse(fs.readFileSync(filepath, "utf8"));
    return true;
  } catch {
    return false;
  } finally {
    fs.closeSync(fd);
  }
};

export const waitForClientBundleAnalysisArtifacts = async (
  app: App,
  outputTarget: "dev" | "bin",
  timeoutMs: number = 30000,
) => {
  const startedAt = Date.now();
  const { reportPath, statsPath } = getClientBundleAnalysisReportPaths(
    app,
    outputTarget,
  );
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

  throw new Error(
    `Timed out waiting for bundle analysis artifacts to complete: ${reportPath}, ${statsPath}`,
  );
};
