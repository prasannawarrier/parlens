
import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { KINDS, DEFAULT_RELAYS } from '../lib/nostr';

export function useParkingLogs() {
    const { pool, pubkey } = useAuth();
    const [logs, setLogs] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);

    // Track locally deleted d-tags to prevent re-appearing after refetch
    const deletedDTagsRef = useRef<Set<string>>(new Set());

    const fetchLogs = useCallback(async () => {
        if (!pubkey || !pool) return;

        setLoading(true);


        try {
            // Fetch both logs and deletion events
            const events = await pool.querySync(DEFAULT_RELAYS, {
                kinds: [KINDS.PARKING_LOG, 5],
                authors: [pubkey],
                limit: 100, // Increase limit to get deletions too
            });



            // Process deletions
            const deletedCoordinates = new Set<string>();
            const deletionEvents = events.filter(e => e.kind === 5);

            for (const de of deletionEvents) {
                // Check 'a' tags for addressable events (d-tags)
                for (const tag of de.tags) {
                    if (tag[0] === 'a') {
                        deletedCoordinates.add(tag[1]);
                    }
                }
            }

            // Filter out logs (locally deleted OR found in deletion events)
            const logEvents = events.filter(e => e.kind === KINDS.PARKING_LOG);
            const validLogs = logEvents.filter(event => {
                const dTag = event.tags?.find((t: string[]) => t[0] === 'd')?.[1];
                if (!dTag) return true; // Should have d-tag

                // Check local deletion cache
                if (deletedDTagsRef.current.has(dTag)) return false;

                // Check NIP-09 deletion
                // Coordinate format: kind:pubkey:d-tag
                const coordinate = `${event.kind}:${event.pubkey}:${dTag}`;
                if (deletedCoordinates.has(coordinate)) return false;

                return true;
            });


            const sorted = validLogs.sort((a, b) => b.created_at - a.created_at);
            setLogs(sorted);
        } catch (e) {
            console.error('[useParkingLogs] Fetch error:', e);
        } finally {
            setLoading(false);
        }
    }, [pool, pubkey]);

    // Mark a d-tag as deleted locally (called from ProfileButton after deletion)
    const markDeleted = useCallback((dTag: string) => {
        console.log('[useParkingLogs] Marking deleted:', dTag);
        deletedDTagsRef.current.add(dTag);
    }, []);

    // Fetch on mount and when pubkey changes (like RouteButton)
    useEffect(() => {
        if (pubkey) {
            fetchLogs();
        }
    }, [pubkey, fetchLogs]);

    // Listen for parking-log-updated event for immediate refetch
    // Also listen for visibility-refresh when app returns from background (iOS)
    useEffect(() => {
        const handleUpdate = () => {

            fetchLogs();
        };

        window.addEventListener('parking-log-updated', handleUpdate);
        window.addEventListener('visibility-refresh', handleUpdate);
        return () => {
            window.removeEventListener('parking-log-updated', handleUpdate);
            window.removeEventListener('visibility-refresh', handleUpdate);
        };
    }, [fetchLogs]);

    return { logs, loading, refetch: fetchLogs, markDeleted };
}
