/*----------------------------------
- TYPES
----------------------------------*/

export type TAgentNextAction = {
    command: string;
    label: string;
    reason?: string;
};

export type TAgentOmittedDetail = {
    command: string;
    reason: string;
};

export type TAgentResponse<TData extends object> = {
    ok: true;
    format: 'proteum-agent-v1';
    summary: string;
    data: TData;
    nextActions?: TAgentNextAction[];
    omitted?: TAgentOmittedDetail[];
    fullDetailCommand?: string;
};

/*----------------------------------
- HELPERS
----------------------------------*/

export const truncateForAgent = (value: string, max = 220) => (value.length <= max ? value : `${value.slice(0, max)}...`);

export const compactList = <TValue>(values: TValue[], limit: number) => values.slice(0, Math.max(0, limit));

export const printJson = (value: object) => {
    console.log(JSON.stringify(value, null, 2));
};

export const printAgentResponse = <TData extends object>(response: Omit<TAgentResponse<TData>, 'format' | 'ok'>) => {
    printJson({
        ok: true,
        format: 'proteum-agent-v1',
        ...response,
    });
};

export const quoteCommandArgument = (value: string) => JSON.stringify(value);
