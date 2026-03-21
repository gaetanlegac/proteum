import React from "react";

export type TDeferredModuleLoader<TModule> = () => Promise<TModule>;

export type TDeferredModuleStrategy = "immediate" | "idle" | "visible";

export type TDeferredModuleOptions = {
  enabled?: boolean;
  when?: TDeferredModuleStrategy;
  timeoutMs?: number;
  rootMargin?: string;
  cache?: boolean;
};

export type TDeferredModuleResult<TModule> = {
  value?: TModule;
  error?: unknown;
  isLoaded: boolean;
  isLoading: boolean;
  load: () => Promise<TModule>;
  ref: React.RefCallback<HTMLElement>;
};

type TDeferredModuleEntry<TModule> = {
  status: "idle" | "loading" | "loaded" | "error";
  promise?: Promise<TModule>;
  value?: TModule;
  error?: unknown;
};

const moduleCache = new WeakMap<
  TDeferredModuleLoader<unknown>,
  TDeferredModuleEntry<unknown>
>();

const getModuleEntry = <TModule,>(
  loader: TDeferredModuleLoader<TModule>,
  cacheEnabled: boolean,
): TDeferredModuleEntry<TModule> | undefined => {
  if (!cacheEnabled) return undefined;

  return moduleCache.get(loader) as TDeferredModuleEntry<TModule> | undefined;
};

const setModuleEntry = <TModule,>(
  loader: TDeferredModuleLoader<TModule>,
  entry: TDeferredModuleEntry<TModule>,
  cacheEnabled: boolean,
) => {
  if (!cacheEnabled) return;

  moduleCache.set(
    loader as TDeferredModuleLoader<unknown>,
    entry as TDeferredModuleEntry<unknown>,
  );
};

const getInitialState = <TModule,>(
  loader: TDeferredModuleLoader<TModule>,
  cacheEnabled: boolean,
) => {
  const entry = getModuleEntry(loader, cacheEnabled);

  return {
    value: entry?.value,
    error: entry?.error,
    isLoaded: entry?.status === "loaded",
    isLoading: entry?.status === "loading",
  };
};

export default function useDeferredModule<TModule>(
  loader: TDeferredModuleLoader<TModule>,
  {
    enabled = true,
    when = "immediate",
    timeoutMs = 1000,
    rootMargin = "200px",
    cache = true,
  }: TDeferredModuleOptions = {},
): TDeferredModuleResult<TModule> {
  const mountedRef = React.useRef(true);
  const [targetNode, setTargetNode] = React.useState<HTMLElement | null>(null);
  const [state, setState] = React.useState(() =>
    getInitialState(loader, cache),
  );

  React.useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
    };
  }, []);

  React.useEffect(() => {
    setState(getInitialState(loader, cache));
  }, [loader, cache]);

  const ref = React.useCallback<React.RefCallback<HTMLElement>>(
    (node) => {
      if (when !== "visible") return;
      setTargetNode(node);
    },
    [when],
  );

  const load = React.useCallback(async () => {
    const cachedEntry = getModuleEntry(loader, cache);

    if (cachedEntry?.status === "loaded") {
      if (mountedRef.current)
        setState({
          value: cachedEntry.value,
          error: undefined,
          isLoaded: true,
          isLoading: false,
        });

      return cachedEntry.value as TModule;
    }

    if (cachedEntry?.status === "loading" && cachedEntry.promise) {
      if (mountedRef.current)
        setState((current) => ({
          ...current,
          isLoading: true,
        }));

      return cachedEntry.promise;
    }

    const promise = loader();
    const nextEntry: TDeferredModuleEntry<TModule> = {
      status: "loading",
      promise,
    };

    setModuleEntry(loader, nextEntry, cache);

    if (mountedRef.current)
      setState((current) => ({
        ...current,
        error: undefined,
        isLoading: true,
      }));

    try {
      const value = await promise;
      setModuleEntry(
        loader,
        {
          status: "loaded",
          value,
        },
        cache,
      );

      if (mountedRef.current)
        setState({
          value,
          error: undefined,
          isLoaded: true,
          isLoading: false,
        });

      return value;
    } catch (error) {
      setModuleEntry(
        loader,
        {
          status: "error",
          error,
        },
        cache,
      );

      if (mountedRef.current)
        setState({
          value: undefined,
          error,
          isLoaded: false,
          isLoading: false,
        });

      throw error;
    }
  }, [cache, loader]);

  React.useEffect(() => {
    if (!enabled || state.isLoaded || state.isLoading) return;

    if (when === "immediate") {
      void load();
      return;
    }

    if (when === "idle") {
      if (typeof window === "undefined") return;

      let cancelled = false;

      if ("requestIdleCallback" in window) {
        const idleId = window.requestIdleCallback(
          () => {
            if (!cancelled) void load();
          },
          { timeout: timeoutMs },
        );

        return () => {
          cancelled = true;
          window.cancelIdleCallback(idleId);
        };
      }

      const timeoutId = window.setTimeout(() => {
        if (!cancelled) void load();
      }, timeoutMs);

      return () => {
        cancelled = true;
        window.clearTimeout(timeoutId);
      };
    }

    if (when === "visible") {
      if (typeof window === "undefined" || !targetNode) return;

      if (typeof IntersectionObserver === "undefined") {
        void load();
        return;
      }

      const observer = new IntersectionObserver(
        (entries) => {
          const isVisible = entries.some((entry) => entry.isIntersecting);
          if (!isVisible) return;

          observer.disconnect();
          void load();
        },
        {
          rootMargin,
        },
      );

      observer.observe(targetNode);

      return () => observer.disconnect();
    }
  }, [
    enabled,
    load,
    rootMargin,
    state.isLoaded,
    state.isLoading,
    targetNode,
    timeoutMs,
    when,
  ]);

  return {
    ...state,
    load,
    ref,
  };
}
