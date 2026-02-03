import { useEffect, useRef } from 'react';

/**
 * Hook to handle iOS Safari PWA visibility changes.
 * When the app returns to foreground after being backgrounded for more than
 * the threshold duration, it triggers a callback to refresh stale data.
 * 
 * This is critical for iOS where WebSocket connections and timers are suspended
 * when the app is backgrounded.
 */
export function useVisibilityRefresh(onVisible: () => void, thresholdMs: number = 5000) {
    const lastHiddenTime = useRef<number>(0);
    const callbackRef = useRef(onVisible);

    // Keep callback ref updated to avoid stale closures
    useEffect(() => {
        callbackRef.current = onVisible;
    }, [onVisible]);

    useEffect(() => {
        const handleVisibilityChange = () => {
            if (document.visibilityState === 'hidden') {
                lastHiddenTime.current = Date.now();

            } else if (document.visibilityState === 'visible') {
                const hiddenDuration = Date.now() - lastHiddenTime.current;


                // If backgrounded for more than threshold, force refresh
                if (lastHiddenTime.current > 0 && hiddenDuration > thresholdMs) {

                    callbackRef.current();
                }
            }
        };

        // Also handle iOS-specific pageshow event for bfcache restoration
        const handlePageShow = (event: PageTransitionEvent) => {
            if (event.persisted) {

                callbackRef.current();
            }
        };

        document.addEventListener('visibilitychange', handleVisibilityChange);
        window.addEventListener('pageshow', handlePageShow);

        return () => {
            document.removeEventListener('visibilitychange', handleVisibilityChange);
            window.removeEventListener('pageshow', handlePageShow);
        };
    }, [thresholdMs]);
}

/**
 * Global visibility refresh dispatcher.
 * Dispatches custom events that other parts of the app can listen to.
 */
export function dispatchVisibilityRefresh() {

    window.dispatchEvent(new Event('visibility-refresh'));
    window.dispatchEvent(new Event('parking-log-updated'));
}
