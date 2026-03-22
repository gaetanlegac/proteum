const ansiPattern = /\u001b\[[0-9;]*m/g;

export type TRow = {
    label: string;
    value: string;
};

export const stripAnsi = (value: string) => value.replace(ansiPattern, '');

const visibleLength = (value: string) => stripAnsi(value).length;

export const getTerminalWidth = () => {
    const width = process.stdout.columns ?? 100;
    return Math.max(72, Math.min(width, 110));
};

export const wrapText = (
    value: string,
    {
        width = getTerminalWidth(),
        indent = '',
        nextIndent = indent,
    }: {
        width?: number;
        indent?: string;
        nextIndent?: string;
    } = {},
) => {
    const words = value.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) return indent.trimEnd();

    const lines: string[] = [];
    let currentLine = indent;

    for (const word of words) {
        const separator = currentLine.trim().length === 0 ? '' : ' ';
        const nextLine = `${currentLine}${separator}${word}`;

        if (visibleLength(nextLine) > width && currentLine.trim().length > 0) {
            lines.push(currentLine);
            currentLine = `${nextIndent}${word}`;
            continue;
        }

        currentLine = nextLine;
    }

    lines.push(currentLine);
    return lines.join('\n');
};

export const renderRows = (
    rows: TRow[],
    {
        indent = '  ',
        minLabelWidth = 14,
        maxLabelWidth = 28,
    }: {
        indent?: string;
        minLabelWidth?: number;
        maxLabelWidth?: number;
    } = {},
) => {
    if (rows.length === 0) return `${indent}none`;

    const width = getTerminalWidth();
    const labelWidth = Math.min(
        maxLabelWidth,
        Math.max(
            minLabelWidth,
            ...rows.map((row) => visibleLength(row.label)),
        ),
    );

    return rows
        .map((row) => {
            const paddedLabel = `${row.label}${' '.repeat(Math.max(labelWidth - visibleLength(row.label), 0))}`;
            const prefix = `${indent}${paddedLabel}  `;
            const continuation = `${indent}${' '.repeat(labelWidth)}  `;
            return wrapText(row.value, { width, indent: prefix, nextIndent: continuation });
        })
        .join('\n');
};
