import React from 'react';
import type { ApexOptions } from 'apexcharts';

const readErrorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

export default function ApexChart({
    emptyLabel = 'No chart data available.',
    options,
}: {
    emptyLabel?: string;
    options?: ApexOptions;
}) {
    const mountRef = React.useRef<HTMLDivElement | null>(null);
    const [errorMessage, setErrorMessage] = React.useState<string>();

    React.useEffect(() => {
        const target = mountRef.current;
        if (!target || !options) return;

        let disposed = false;
        let chart: { destroy: () => void; render: () => Promise<void> | void } | undefined;

        target.innerHTML = '';
        setErrorMessage(undefined);

        void (async () => {
            try {
                const module = await import('apexcharts');
                if (disposed || !mountRef.current) return;

                const ApexCharts = module.default;
                chart = new ApexCharts(mountRef.current, options);
                await chart.render();
            } catch (error) {
                if (!disposed) setErrorMessage(readErrorMessage(error));
            }
        })();

        return () => {
            disposed = true;
            chart?.destroy();
            target.innerHTML = '';
        };
    }, [options]);

    if (!options) return <div className="proteum-profiler__empty">{emptyLabel}</div>;

    if (errorMessage) {
        return (
            <div className="proteum-profiler__chartMount">
                <div className="proteum-profiler__row">
                    <div className="proteum-profiler__rowHeader">
                        <strong>Chart error</strong>
                    </div>
                    <div className="proteum-profiler__mono">{errorMessage}</div>
                </div>
            </div>
        );
    }

    return (
        <div className="proteum-profiler__chartMount">
            <div ref={mountRef} />
        </div>
    );
}
