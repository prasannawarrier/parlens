import { useRef, useState, useCallback, useEffect } from 'react';
import NoSleep from 'nosleep.js';

/**
 * useWakeLock - Prevents screen from sleeping
 * Uses NoSleep.js for cross-browser support (iOS, Android, Desktop)
 * Refactored to prevent dependency cycles and stale closures.
 */
export const useWakeLock = () => {
    const noSleepRef = useRef<NoSleep | null>(null);
    const shouldBeLockedRef = useRef(false); // Track intent
    const isLockedRef = useRef(false); // Track actual status (sync)
    const [isLocked, setIsLocked] = useState(false); // For UI/React updates only

    // Stable callback - No dependencies
    const requestLock = useCallback(async () => {
        shouldBeLockedRef.current = true;
        if (noSleepRef.current) {
            try {
                // Check reliable ref instead of potentially stale state
                if (!isLockedRef.current) {
                    await noSleepRef.current.enable();
                    isLockedRef.current = true;
                    setIsLocked(true);
                }
            } catch (err) {
                // console.warn('[Parlens] Failed to acquire NoSleep Wake Lock:', err);
                isLockedRef.current = false;
                setIsLocked(false);
            }
        }
    }, []);

    // Stable callback - No dependencies
    const releaseLock = useCallback(async () => {
        shouldBeLockedRef.current = false;
        if (noSleepRef.current) {
            try {
                // If we are locked, disable it
                if (isLockedRef.current) {
                    noSleepRef.current.disable();
                    isLockedRef.current = false;
                    setIsLocked(false);
                }
            } catch (err) {
                // console.warn('[Parlens] Failed to release NoSleep Wake Lock:', err);
            }
        }
    }, []);

    // Initialize NoSleep instance
    useEffect(() => {
        // Create instance once
        if (!noSleepRef.current) {
            noSleepRef.current = new NoSleep();
        }

        const handleVisibilityChange = async () => {
            if (document.visibilityState === 'visible') {
                // Check intent AND status using fresh Refs
                if (shouldBeLockedRef.current && !isLockedRef.current) {
                    try {
                        if (noSleepRef.current) {
                            await noSleepRef.current.enable();
                            isLockedRef.current = true;
                            setIsLocked(true);
                        }
                    } catch (e) {
                        // Silent fail (browser policy blocking auto-play without gesture)
                    }
                }
            }
        };

        // Auto-enable if intended (e.g. on mount/click)
        const tryEnable = async () => {
            requestLock();
        };

        document.addEventListener('visibilitychange', handleVisibilityChange);
        document.addEventListener('click', tryEnable, { once: true });

        // Initial attempt
        tryEnable();

        return () => {
            document.removeEventListener('visibilitychange', handleVisibilityChange);
            document.removeEventListener('click', tryEnable);
            // On unmount, fully cleanup
            if (noSleepRef.current) {
                noSleepRef.current.disable();
                isLockedRef.current = false;
            }
        };
    }, []); // STRICTLY EMPTY DEPENDENCY ARRAY - Run once on mount

    return { requestLock, releaseLock, isLocked };
};
