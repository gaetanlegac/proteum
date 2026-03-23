import path from 'path';

export const normalizePath = (value: string) => value.replace(/\\/g, '/');

export const normalizeAbsolutePath = (value: string) => normalizePath(path.resolve(value));

export const getGeneratedImportPath = (fromDir: string, targetFile: string) => {
    const relativeImportPath = path.relative(fromDir, targetFile).replace(/\\/g, '/');
    const normalizedImportPath = relativeImportPath.startsWith('.') ? relativeImportPath : './' + relativeImportPath;

    return normalizedImportPath.replace(/\.(ts|tsx|js|jsx)$/, '');
};
