type TDevEvent = { type: 'reload'; reason: 'server' | 'manual' | 'client' };

const devEventsPath = '/__proteum_hmr';
let reloadPending = false;
let source: EventSource | null = null;

const delay = (timeout: number) => new Promise<void>((resolve) => window.setTimeout(resolve, timeout));

const buildDevEventsUrl = () => {
    if (typeof window === 'undefined') return null;
    if (PROTEUM_DEV_EVENT_PORT === null) return null;

    const hostname = window.location.hostname || 'localhost';
    return `${window.location.protocol}//${hostname}:${PROTEUM_DEV_EVENT_PORT}${devEventsPath}`;
};

const waitForServer = async () => {
    for (let attempt = 0; attempt < 40; attempt += 1) {
        try {
            const response = await fetch(`/ping?ts=${Date.now()}`, { cache: 'no-store' });
            if (response.ok) return;
        } catch (error) {}

        await delay(250);
    }
};

const requestReload = async () => {
    if (reloadPending) return;
    reloadPending = true;
    source?.close();
    source = null;

    try {
        await waitForServer();
    } finally {
        window.location.reload();
    }
};

const handleEvent = (_event: TDevEvent) => {
    void requestReload();
};

const devEventsUrl = buildDevEventsUrl();

if (devEventsUrl && typeof EventSource !== 'undefined') {
    source = new EventSource(devEventsUrl);

    source.onmessage = (event) => {
        try {
            const payload = JSON.parse(event.data) as TDevEvent;
            handleEvent(payload);
        } catch (error) {
            console.warn('[hmr] Failed to parse dev event payload.', error);
        }
    };

    source.onerror = () => {
        // EventSource reconnects automatically. Transient disconnects are expected
        // during rebuilds and page reloads, so warning here would be mostly noise.
    };
} else {
    console.warn('[hmr] Dev event stream is unavailable in this environment.');
}
