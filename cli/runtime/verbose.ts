import cli from '../context';

export const isVerbose = () => cli.verbose === true;

export const logVerbose = (...args: unknown[]) => {
    if (!isVerbose()) return;

    console.info(...args);
};

export const logVerboseWarn = (...args: unknown[]) => {
    if (!isVerbose()) return;

    console.warn(...args);
};
