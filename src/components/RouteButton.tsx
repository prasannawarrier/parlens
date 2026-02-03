import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Route, X, Trash2, MapPin, Eye, EyeOff, Navigation, FolderOpen, Clock, MapPinned, Save, Pencil, Check, ArrowUpDown, ChevronUp, ChevronDown } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { KINDS, DEFAULT_RELAYS } from '../lib/nostr';
import type { RouteLogContent } from '../lib/nostr';
import { encryptParkingLog, decryptParkingLog } from '../lib/encryption';
import { getSuggestions, parseCoordinate, formatCoords, encodeGeohash } from '../lib/geo';

interface Waypoint {
    id: string;
    name: string;
    lat: number;
    lon: number;
}

interface SavedRoute {
    id: string;
    dTag: string;
    decryptedContent: RouteLogContent;
    created_at: number;
}

interface RouteButtonProps {
    vehicleType: 'bicycle' | 'motorcycle' | 'car';
    onRouteChange: (route: [number, number][] | null, alternateRoute: [number, number][] | null, waypoints: { lat: number; lon: number }[] | null, showOnMap: boolean) => void;
    currentLocation: [number, number] | null;
    onDropPinModeChange?: (enabled: boolean) => void;
    pendingWaypoints?: { lat: number; lon: number; name?: string }[] | null;
    onDropPinConsumed?: () => void;
    onOpenChange?: (isOpen: boolean) => void;
    onWaypointsChange?: (waypoints: Waypoint[]) => void;
    onRequestOrientationPermission?: () => void;
    // Controlled state props
    isOpen?: boolean;
    onClose?: () => void;
    hideTrigger?: boolean;
    onRouteCreated?: () => void;
}



interface NominatimResult {
    place_id: number;
    lat: string;
    lon: string;
    display_name: string;
    type: string;
}



export const RouteButton: React.FC<RouteButtonProps> = ({ vehicleType, onRouteChange, currentLocation, onDropPinModeChange, pendingWaypoints, onDropPinConsumed, onOpenChange, onWaypointsChange, onRequestOrientationPermission, isOpen: controlledIsOpen, onClose, hideTrigger, onRouteCreated }) => {
    const { pool, pubkey, signEvent } = useAuth();
    const [internalIsOpen, setInternalIsOpen] = useState(false);

    // Use controlled state if provided, otherwise internal
    const isOpen = controlledIsOpen !== undefined ? controlledIsOpen : internalIsOpen;

    // Helper to update state (and notify parent if needed)
    const setIsOpen = (val: boolean) => {
        setInternalIsOpen(val);
        if (!val && onClose) {
            onClose();
        }
    };

    // Notify parent on open change
    useEffect(() => {
        onOpenChange?.(isOpen);
    }, [isOpen, onOpenChange]);
    const [waypoints, setWaypoints] = useState<Waypoint[]>([]);

    // Notify parent on waypoints change
    useEffect(() => {
        onWaypointsChange?.(waypoints);
    }, [waypoints, onWaypointsChange]);

    const [searchQuery, setSearchQuery] = useState('');
    const [showOnMap, setShowOnMap] = useState(false);
    const [routeCoords, setRouteCoords] = useState<[number, number][] | null>(null);
    const [alternateRouteCoords, setAlternateRouteCoords] = useState<[number, number][] | null>(null);
    const [isCreatingRoute, setIsCreatingRoute] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);
    const autoCreatePendingRef = useRef(false); // Track when to auto-create route after waypoints update

    // Saved routes state
    const [savedRoutes, setSavedRoutes] = useState<SavedRoute[]>([]);
    const [routeName, setRouteName] = useState('');
    const [isSaving, setIsSaving] = useState(false);
    const [isLoadingSaved, setIsLoadingSaved] = useState(false);
    const [showSavedRoutes, setShowSavedRoutes] = useState(false);
    const [dropPinMode, setDropPinMode] = useState(false);
    const [editingWaypointId, setEditingWaypointId] = useState<string | null>(null);
    const [editingName, setEditingName] = useState('');
    const [isDeleting, setIsDeleting] = useState(false);
    const [countryCode, setCountryCode] = useState<string | null>(null);
    const [snappedWaypoints, setSnappedWaypoints] = useState<{ [index: number]: { lat: number, lon: number } }>({});
    const [onlineSuggestions, setOnlineSuggestions] = useState<NominatimResult[]>([]);

    // Online search effect
    useEffect(() => {
        if (!searchQuery || searchQuery.length < 3) {
            setOnlineSuggestions([]);
            return;
        }

        // Skip if coordinate/plus code
        if (parseCoordinate(searchQuery)) return;

        const timer = setTimeout(() => {
            getSuggestions(searchQuery, countryCode, currentLocation, 1) // Limit to 1 result
                .then(setOnlineSuggestions)
                .catch(console.error);
        }, 500);

        return () => clearTimeout(timer);
    }, [searchQuery, countryCode, currentLocation]);
    const deletedDTagsRef = useRef<Set<string>>(new Set());

    // Fetch country code once when location is available
    useEffect(() => {
        const fetchCountry = async () => {
            if (!currentLocation || countryCode) return;
            try {
                const res = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${currentLocation[0]}&lon=${currentLocation[1]}&format=json`);
                const data = await res.json();
                if (data && data.address && data.address.country_code) {
                    setCountryCode(data.address.country_code);
                }
            } catch (e) {
                console.error('[Parlens] Failed to detect country:', e);
            }
        };
        fetchCountry();
    }, [currentLocation, countryCode]);

    // Search saved waypoints from routes (offline search)
    const savedWaypointMatches = React.useMemo(() => {
        if (!searchQuery || searchQuery.length < 2) return [];
        const query = searchQuery.toLowerCase();
        const matches: Array<{ name: string; lat: number; lon: number }> = [];

        for (const route of savedRoutes) {
            for (const wp of route.decryptedContent.waypoints) {
                if (wp.name.toLowerCase().includes(query)) {
                    // Avoid duplicates by name (case-insensitive) to show unique waypoints
                    if (!matches.find(m => m.name.toLowerCase() === wp.name.toLowerCase())) {
                        matches.push({
                            name: wp.name,
                            lat: wp.lat,
                            lon: wp.lon
                        });
                    }
                }
            }
        }
        return matches.slice(0, 5); // Limit to 5 results
    }, [searchQuery, savedRoutes]);

    const removeWaypoint = (id: string) => {
        const newWaypoints = waypoints.filter(w => w.id !== id);
        setWaypoints(newWaypoints);
        // Clear existing route when waypoints change
        setRouteCoords(null);
        setAlternateRouteCoords(null);
        setShowOnMap(false);
        onRouteChange(null, null, newWaypoints, false);
    };

    const clearAllWaypoints = () => {
        setWaypoints([]);
        setRouteCoords(null);
        setAlternateRouteCoords(null);
        setShowOnMap(false);
        onRouteChange(null, null, [], false);
    };



    const moveWaypoint = (index: number, direction: -1 | 1) => {
        if (index + direction < 0 || index + direction >= waypoints.length) return;
        const newWaypoints = [...waypoints];
        // Swap
        [newWaypoints[index], newWaypoints[index + direction]] = [newWaypoints[index + direction], newWaypoints[index]];
        setWaypoints(newWaypoints);

        // Clear route state on change
        setRouteCoords(null);
        setAlternateRouteCoords(null);
        setShowOnMap(false);
        onRouteChange(null, null, newWaypoints, false);
    };

    const reverseWaypoints = () => {
        const reversed = [...waypoints].reverse();
        setWaypoints(reversed);
        setRouteCoords(null);
        setAlternateRouteCoords(null);
        setShowOnMap(false);
        onRouteChange(null, null, reversed, false);
    };

    const createRoute = async () => {
        if (waypoints.length < 2) {
            alert('Add at least 2 waypoints to create a route');
            return;
        }

        setIsCreatingRoute(true);
        try {
            // Map vehicle type to OSRM profile
            const osrmProfileMap: Record<string, string> = {
                'bicycle': 'bike',
                'motorcycle': 'driving',
                'car': 'driving'
            };
            // Fallback to 'driving' if invalid
            const osrmProfile = osrmProfileMap[vehicleType] || 'driving';

            // For each segment between waypoints, get primary and alternate routes
            const primarySegments: [number, number][][] = [];
            const alternateSegments: any[] = [];
            const newSnappedWaypoints: { [index: number]: { lat: number, lon: number } } = {};

            // Iterate through segments (A->B, B->C)
            // This matches the logic from Jan 22 (v1.9.9) which was stable,
            // but adds a DELAY to prevent the Rate Limiting (straight line) issue.
            for (let i = 0; i < waypoints.length - 1; i++) {
                const start = waypoints[i];
                const end = waypoints[i + 1];

                // Use fixed precision to avoid URL errors
                const coords = `${start.lon.toFixed(6)},${start.lat.toFixed(6)};${end.lon.toFixed(6)},${end.lat.toFixed(6)}`;

                console.log(`[Parlens] Fetching segment ${i + 1}/${waypoints.length - 1}: ${start.name} -> ${end.name}`);

                // CRITICAL: Add delay to avoid OSRM Rate Limit (429) which causes straight lines
                if (i > 0) {
                    await new Promise(resolve => setTimeout(resolve, 400));
                }

                const response = await fetch(
                    `https://router.project-osrm.org/route/v1/${osrmProfile}/${coords}?overview=full&geometries=geojson&alternatives=true`
                );

                if (!response.ok) {
                    if (response.status === 429) {
                        throw new Error(`Segment ${i + 1} failed: Rate Limit. Please try again slowly.`);
                    }
                    throw new Error(`Segment ${i + 1} failed: ${response.status}`);
                }

                const data = await response.json();

                if (data.code === 'Ok' && data.routes && data.routes[0]) {
                    // Extract snapped waypoints (start of segment and end of segment)
                    if (data.waypoints && data.waypoints.length >= 2) {
                        const startSnap = data.waypoints[0].location;
                        const endSnap = data.waypoints[1].location;

                        // Store snapped coordinates
                        if (!newSnappedWaypoints[i]) {
                            newSnappedWaypoints[i] = { lat: startSnap[1], lon: startSnap[0] };
                        }
                        newSnappedWaypoints[i + 1] = { lat: endSnap[1], lon: endSnap[0] };
                    }

                    // Primary Route Geometry
                    const primaryCoords = data.routes[0].geometry.coordinates.map(
                        (coord: [number, number]) => [coord[1], coord[0]] as [number, number]
                    );
                    primarySegments.push(primaryCoords);

                    // Alternate Route Geometry (if available)
                    if (data.routes.length > 1) {
                        const altCoords = data.routes[1].geometry.coordinates.map(
                            (coord: [number, number]) => [coord[1], coord[0]] as [number, number]
                        );
                        alternateSegments.push(altCoords);
                    } else {
                        // Use primary if no alternate exists for this segment
                        alternateSegments.push(primaryCoords);
                    }
                } else {
                    throw new Error(`No route found for segment ${i + 1}`);
                }
            }

            // Combine all segments into full routes
            const primaryCoords: [number, number][] = [];
            const altCoords: [number, number][] = [];

            for (let i = 0; i < primarySegments.length; i++) {
                // Skip the first point of subsequent segments (it duplicates the last point of previous)
                const startIndex = i === 0 ? 0 : 1;
                primaryCoords.push(...primarySegments[i].slice(startIndex));
                altCoords.push(...alternateSegments[i].slice(startIndex));
            }


            setRouteCoords(primaryCoords);
            setAlternateRouteCoords(altCoords);
            setSnappedWaypoints(newSnappedWaypoints);
            setShowOnMap(true);

            // Use snapped waypoints for display if all were successfully snapped
            const displayWaypoints = Object.keys(newSnappedWaypoints).length === waypoints.length
                ? waypoints.map((wp, idx) => ({ ...wp, ...newSnappedWaypoints[idx] }))
                : waypoints;

            onRouteChange(primaryCoords, altCoords, displayWaypoints.map(w => ({ lat: w.lat, lon: w.lon })), true);

            if (onRequestOrientationPermission) {
                onRequestOrientationPermission();
            }

            setIsOpen(false);
            onRouteCreated?.();

        } catch (error: any) {
            console.error('Route creation error:', error);
            alert(`Failed to create route: ${error.message || 'Unknown error'}`);

            // Fallback: Straight lines
            const straightLineCoords = waypoints.map(w => [w.lat, w.lon] as [number, number]);
            setRouteCoords(straightLineCoords);
            setAlternateRouteCoords(null);
            setSnappedWaypoints({});
            setShowOnMap(true);
            onRouteChange(straightLineCoords, null, waypoints.map(w => ({ lat: w.lat, lon: w.lon })), true);
            setIsOpen(false);
            onRouteCreated?.();
        } finally {
            setIsCreatingRoute(false);
        }
    };


    const toggleShowOnMap = () => {
        const newValue = !showOnMap;
        setShowOnMap(newValue);
        // If we have snapped waypoints for all points, use them for visualization only
        // Fallback to original waypoints if snapping failed for some reason
        const displayWaypoints = Object.keys(snappedWaypoints).length === waypoints.length
            ? waypoints.map((wp, idx) => ({ ...wp, ...snappedWaypoints[idx] }))
            : waypoints;

        // Pass snapped waypoints to parent for map rendering
        onRouteChange(routeCoords, alternateRouteCoords, displayWaypoints.map(w => ({ lat: w.lat, lon: w.lon })), newValue);
    };

    // Fetch saved routes on mount
    const fetchSavedRoutes = useCallback(async () => {
        if (!pool || !pubkey) return;

        setIsLoadingSaved(true);
        try {
            const events = await pool.querySync(DEFAULT_RELAYS, {
                kinds: [KINDS.ROUTE_LOG],
                authors: [pubkey],
            });


            // Get seckey for decryption
            const privkeyHex = localStorage.getItem('parlens_privkey');
            const seckey = privkeyHex ? new Uint8Array(privkeyHex.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16))) : undefined;

            const routes: SavedRoute[] = [];
            for (const event of events) {
                // Skip deleted routes (server-side)
                if (event.tags.find(t => t[0] === 'deleted')) continue;

                // Skip locally deleted routes
                const dTag = event.tags.find(t => t[0] === 'd')?.[1] || '';
                if (dTag && deletedDTagsRef.current.has(dTag)) continue;

                // Skip empty content
                if (!event.content) continue;

                try {
                    const decrypted = await decryptParkingLog(event.content, pubkey, seckey);
                    if (decrypted) {
                        const dTag = event.tags.find(t => t[0] === 'd')?.[1] || '';
                        routes.push({
                            id: event.id,
                            dTag,
                            decryptedContent: decrypted as RouteLogContent,
                            created_at: event.created_at,
                        });
                    }
                } catch (e) {
                    console.warn('[Parlens] Failed to decrypt route:', e);
                }
            }

            // Merge with existing routes to prevent data loss (e.g. offline creations)
            setSavedRoutes(prev => {
                const mergedMap = new Map<string, SavedRoute>();

                // Keep existing (cached) routes
                prev.forEach(r => mergedMap.set(r.id, r));

                // Merge/Overwrite with fresh network data
                routes.forEach(r => mergedMap.set(r.id, r));

                const merged = Array.from(mergedMap.values()).sort((a, b) => b.created_at - a.created_at);

                // Update local cache with the merged result
                try {
                    localStorage.setItem('parlens_route_cache_v1', JSON.stringify(merged));
                } catch (e) {
                    console.warn('[Parlens] Failed to cache routes:', e);
                }

                return merged;
            });
        } catch (error) {
            console.error('Error fetching saved routes:', error);
        } finally {
            setIsLoadingSaved(false);
        }
    }, [pool, pubkey]);

    // Load saved routes when modal opens
    useEffect(() => {
        if (isOpen && pubkey) {
            // 1. Load from cache first for immediate display
            try {
                const cached = localStorage.getItem('parlens_route_cache_v1');
                if (cached) {
                    const parsed = JSON.parse(cached);
                    setSavedRoutes(parsed);
                }
            } catch (e) {
                console.warn('[Parlens] Failed to load cached routes:', e);
            }

            // 2. Fetch from network to sync
            fetchSavedRoutes();
        }
    }, [isOpen, pubkey, fetchSavedRoutes]);

    // Handle drop pin mode toggle
    const toggleDropPinMode = () => {
        const newMode = !dropPinMode;
        setDropPinMode(newMode);
        onDropPinModeChange?.(newMode);
        if (newMode) {
            setIsOpen(false); // Close modal so user can see map
            // Force immediate sync of current waypoints to map
            onWaypointsChange?.(waypoints);
        }
    };

    useEffect(() => {
        if (pendingWaypoints) {
            if (pendingWaypoints.length > 0) {
                // Detect if this is a "Create Route" from popup (starts with Current Location)
                // vs drop-pin mode (should append to existing waypoints)
                const isFromPopup = pendingWaypoints.some(wp => wp.name === 'Current Location');

                const newWaypoints = pendingWaypoints.map((wp, index) => ({
                    id: crypto.randomUUID(),
                    name: wp.name || `Pin ${(isFromPopup ? 0 : waypoints.length) + index + 1}`,
                    lat: wp.lat,
                    lon: wp.lon
                }));

                // From popup: replace waypoints entirely for fresh route
                // From drop-pin: append to existing waypoints
                const finalWaypoints = isFromPopup ? newWaypoints : [...waypoints, ...newWaypoints];
                const totalAfterAdd = finalWaypoints.length;

                // Clear existing route visualization
                setWaypoints(finalWaypoints);
                setRouteCoords(null);
                setAlternateRouteCoords(null);
                setShowOnMap(false);
                onRouteChange(null, null, finalWaypoints, false);
                setSnappedWaypoints({});

                // If we now have 2+ waypoints AND from popup, auto-create route
                // Don't auto-create in drop-pin mode - let user manually create when ready
                if (isFromPopup && totalAfterAdd >= 2) {
                    autoCreatePendingRef.current = true;
                }
            }

            onDropPinConsumed?.();

            // Only open modal if not auto-creating (need user to add more waypoints)
            if (!autoCreatePendingRef.current) {
                setIsOpen(true);
            }
            onDropPinModeChange?.(false);
        }
    }, [pendingWaypoints, onDropPinConsumed, onDropPinModeChange, onRouteChange]);

    // Auto-create route when pending flag is set (from marker popup's Create Route button)
    useEffect(() => {
        if (autoCreatePendingRef.current && waypoints.length >= 2) {
            autoCreatePendingRef.current = false;
            createRoute();
        }
    }, [waypoints]);

    // Save current route
    const saveRoute = async () => {
        if (!pool || !pubkey || !signEvent || !routeCoords || waypoints.length < 2) {
            alert('Please create a route first');
            return;
        }

        const name = routeName.trim() || `Route ${new Date().toLocaleDateString()}`;

        setIsSaving(true);
        try {
            // Use snapped waypoints if available for saving
            const waypointsToSave = Object.keys(snappedWaypoints).length === waypoints.length
                ? waypoints.map((wp, idx) => ({ name: wp.name, lat: snappedWaypoints[idx].lat, lon: snappedWaypoints[idx].lon }))
                : waypoints.map(w => ({ name: w.name, lat: w.lat, lon: w.lon }));

            const routeContent: RouteLogContent = {
                name,
                waypoints: waypointsToSave,
                routeCoords,
                alternateRouteCoords: alternateRouteCoords || undefined,
                vehicleType,
                created_at: Math.floor(Date.now() / 1000),
            };

            // Get seckey from localStorage for local key users
            const privkeyHex = localStorage.getItem('parlens_privkey');
            const seckey = privkeyHex ? new Uint8Array(privkeyHex.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16))) : undefined;

            const encrypted = await encryptParkingLog(routeContent, pubkey, seckey);
            const dTag = `route_${Date.now()}`;

            // Generate hierarchical geohash tags for ALL waypoints (1-10 chars each)
            // This enables finding the route via any sector it passes through
            const allGeohashTags = new Set<string>();
            waypointsToSave.forEach(wp => {
                const fullHash = encodeGeohash(wp.lat, wp.lon, 10);
                for (let i = 1; i <= 10; i++) {
                    allGeohashTags.add(fullHash.substring(0, i));
                }
            });

            const event = {
                kind: KINDS.ROUTE_LOG,
                created_at: Math.floor(Date.now() / 1000),
                tags: [
                    ['d', dTag],
                    ['client', 'parlens'],
                    // Geohash tags for all waypoints (handles multi-sector routes)
                    ...Array.from(allGeohashTags).map(g => ['g', g])
                ],
                content: encrypted,
            };

            const signedEvent = await signEvent(event);

            // Use Promise.allSettled for iOS/Safari compatibility (same as parking logs)
            const results = await Promise.allSettled(pool.publish(DEFAULT_RELAYS, signedEvent));
            const succeeded = results.filter(r => r.status === 'fulfilled').length;

            if (succeeded === 0) {
                console.warn('[Parlens] All relays reported failure, but data may still be saved (iOS quirk)');
            }

            // Update Local Cache immediately with the new route
            const newSavedRoute: SavedRoute = {
                id: signedEvent.id,
                dTag,
                decryptedContent: routeContent,
                created_at: signedEvent.created_at
            };

            setSavedRoutes(prev => {
                const updated = [newSavedRoute, ...prev];
                try {
                    localStorage.setItem('parlens_route_cache_v1', JSON.stringify(updated));
                } catch (e) { console.warn('Cache update failed', e); }
                return updated;
            });

            setRouteName('');
            // No need to fetch immediately if we updated cache, but good for sync consistency
            // setTimeout(() => fetchSavedRoutes(), 500); 
        } catch (error) {
            console.error('[Parlens] Error saving route:', error);
            alert('Failed to save route, try again later');
        } finally {
            setIsSaving(false);
        }
    };

    // Update waypoint name
    const updateWaypointName = (id: string, newName: string) => {
        setWaypoints(prev => prev.map(w => w.id === id ? { ...w, name: newName } : w));
        setEditingWaypointId(null);
        setEditingName('');
    };

    // Start editing a waypoint name
    const startEditingWaypoint = (waypoint: Waypoint) => {
        setEditingWaypointId(waypoint.id);
        setEditingName(waypoint.name);
    };

    // Load a saved route
    const loadRoute = async (saved: SavedRoute) => {
        const content = saved.decryptedContent;

        // Validate routeCoords exists - if not, route data is corrupted
        if (!content.routeCoords || content.routeCoords.length === 0) {
            alert('Failed to load route. Route data is missing or corrupted. Please try creating the route again.');
            return;
        }

        // Restore waypoints
        const restoredWaypoints: Waypoint[] = content.waypoints.map(w => ({
            id: crypto.randomUUID(),
            name: w.name,
            lat: w.lat,
            lon: w.lon,
        }));

        setWaypoints(restoredWaypoints);
        setRouteCoords(content.routeCoords);
        setAlternateRouteCoords(content.alternateRouteCoords || null);
        setSnappedWaypoints({}); // Clear snapped waypoints when loading a saved route
        setShowOnMap(true);
        setShowSavedRoutes(false);

        onRouteChange(
            content.routeCoords,
            content.alternateRouteCoords || null,
            content.waypoints.map(w => ({ lat: w.lat, lon: w.lon })),
            true
        );

        setIsOpen(false);
    };

    // Delete a saved route
    const deleteRoute = async (saved: SavedRoute) => {
        if (!pool || !pubkey || !signEvent) return;

        if (!confirm('Are you sure you want to delete this route? This action cannot be undone.')) return;

        setIsDeleting(true);
        try {
            // Publish a delete event (kind 5)
            const deleteEvent = {
                kind: 5,
                created_at: Math.floor(Date.now() / 1000),
                tags: [
                    ['e', saved.id],
                    ['a', `${KINDS.ROUTE_LOG}:${pubkey}:${saved.dTag}`],
                ],
                content: 'Deleted by user',
            };

            const signedEvent = await signEvent(deleteEvent);
            await Promise.allSettled(pool.publish(DEFAULT_RELAYS, signedEvent));

            // Also publish a replacement with empty content to overwrite
            const replaceEvent = {
                kind: KINDS.ROUTE_LOG,
                created_at: Math.floor(Date.now() / 1000),
                tags: [
                    ['d', saved.dTag],
                    ['deleted', 'true'],
                ],
                content: '',
            };

            const signedReplace = await signEvent(replaceEvent);
            await Promise.allSettled(pool.publish(DEFAULT_RELAYS, signedReplace));

            // Mark as deleted locally so it won't reappear after refetch
            deletedDTagsRef.current.add(saved.dTag);

            setSavedRoutes(prev => {
                const updated = prev.filter(r => r.id !== saved.id);
                try {
                    localStorage.setItem('parlens_route_cache_v1', JSON.stringify(updated));
                } catch (e) { console.warn('Cache update failed', e); }
                return updated;
            });
        } catch (error) {
            console.error('Error deleting route:', error);
            alert('Failed to delete route');
        } finally {
            setIsDeleting(false);
        }
    };

    return (
        <>
            {!hideTrigger && (
                <button
                    onClick={() => setIsOpen(true)}
                    className="h-12 w-12 flex items-center justify-center rounded-[1.5rem] bg-white/80 dark:bg-white/10 backdrop-blur-md text-zinc-600 dark:text-white/70 active:scale-95 transition-all shadow-lg border border-black/5 dark:border-white/10"
                    title="Create Route"
                >
                    <Route size={20} />
                </button>
            )}

            {isOpen && (
                <div className="fixed inset-0 z-[2000] flex flex-col items-center justify-start bg-black/60 backdrop-blur-xl animate-in fade-in duration-300 pt-2 px-4 pb-4">
                    <button
                        onClick={() => setIsOpen(false)}
                        className="absolute inset-0 z-0 cursor-default"
                    />

                    {/* Deleting Overlay - positioned outside modal to cover border */}
                    {isDeleting && (
                        <div className="fixed inset-0 z-[3000] flex items-center justify-center bg-black/70 backdrop-blur-sm">
                            <div className="flex flex-col items-center gap-3">
                                <div className="w-8 h-8 rounded-full border-4 border-white/20 border-t-white animate-spin" />
                                <p className="text-sm font-medium text-white">Deleting...</p>
                            </div>
                        </div>
                    )}

                    {/* Saving Overlay - positioned outside modal to cover border */}
                    {isSaving && (
                        <div className="fixed inset-0 z-[3000] flex items-center justify-center bg-black/70 backdrop-blur-sm">
                            <div className="flex flex-col items-center gap-3">
                                <div className="w-8 h-8 rounded-full border-4 border-white/20 border-t-white animate-spin" />
                                <p className="text-sm font-medium text-white">Saving...</p>
                            </div>
                        </div>
                    )}

                    <div className="relative z-10 w-full max-w-md bg-white dark:bg-[#1c1c1e] rounded-[2rem] shadow-2xl p-6 flex flex-col gap-6 animate-in slide-in-from-bottom-10 duration-300 h-[calc(100vh-1.5rem)] overflow-y-auto no-scrollbar border border-black/5 dark:border-white/5 transition-colors">

                        {/* Header */}
                        <div className="flex items-center justify-between">
                            <h2 className="text-xl font-bold bg-gradient-to-r from-blue-500 to-cyan-500 dark:from-blue-400 dark:to-cyan-400 bg-clip-text text-transparent">
                                Create Route
                            </h2>
                            <button
                                onClick={() => setIsOpen(false)}
                                className="p-2 rounded-full bg-black/5 dark:bg-white/10 transition-colors"
                            >
                                <X size={20} className="text-black/60 dark:text-white/60" />
                            </button>
                        </div>

                        {/* Search Input */}
                        <div className="space-y-2">
                            <label className="text-xs font-bold uppercase tracking-widest text-zinc-400 dark:text-white/20 ml-2">
                                Add Waypoint
                            </label>
                            <div className="relative z-[2000]">
                                <input
                                    ref={inputRef}
                                    type="text"
                                    placeholder="Search waypoint"
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    className={`w-full h-14 bg-zinc-100 dark:bg-white/5 border border-black/5 dark:border-white/10 px-4 pr-12 text-zinc-900 dark:text-white placeholder:text-zinc-400 dark:placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-blue-500 ${(savedWaypointMatches.length > 0 || onlineSuggestions.length > 0 || parseCoordinate(searchQuery))
                                        ? 'rounded-t-xl rounded-b-none'
                                        : 'rounded-xl'
                                        }`}
                                />
                                {searchQuery && (
                                    <button
                                        onClick={() => setSearchQuery('')}
                                        className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 text-zinc-400 dark:text-white/40 active:opacity-50 transition-opacity"
                                    >
                                        <X size={16} />
                                    </button>
                                )}

                                {/* Unified Dropdown */}
                                {(savedWaypointMatches.length > 0 || onlineSuggestions.length > 0 || parseCoordinate(searchQuery)) && (
                                    <div className="absolute top-full left-0 right-0 bg-white dark:bg-zinc-900 rounded-b-xl shadow-xl border-x border-b border-black/5 dark:border-white/5 overflow-hidden z-[3000]">
                                        <div className="max-h-[50vh] overflow-y-auto">
                                            {/* Tags Header */}
                                            <div className="px-4 py-2 bg-zinc-50 dark:bg-white/5 border-t border-black/5 dark:border-white/5 flex items-center gap-2 overflow-x-auto">
                                                {parseCoordinate(searchQuery) && (
                                                    <span className="shrink-0 inline-block px-2.5 py-1 rounded-lg bg-gradient-to-r from-blue-500/10 to-cyan-500/10 dark:from-blue-500/20 dark:to-cyan-500/20 text-[10px] font-bold text-blue-600 dark:text-blue-300 uppercase tracking-wider border border-blue-200 dark:border-blue-500/20">
                                                        {parseCoordinate(searchQuery)?.type === 'plus_code' ? 'Plus Code' : 'Coordinate'}
                                                    </span>
                                                )}
                                                {savedWaypointMatches.length > 0 && (
                                                    <span className="shrink-0 inline-block px-2.5 py-1 rounded-lg bg-gradient-to-r from-emerald-500/10 to-teal-500/10 dark:from-emerald-500/20 dark:to-teal-500/20 text-[10px] font-bold text-emerald-600 dark:text-emerald-300 uppercase tracking-wider border border-emerald-200 dark:border-emerald-500/20">
                                                        Saved Places
                                                    </span>
                                                )}
                                                {onlineSuggestions.length > 0 && (
                                                    <span className="shrink-0 inline-block px-2.5 py-1 rounded-lg bg-gradient-to-r from-violet-500/10 to-fuchsia-500/10 dark:from-violet-500/20 dark:to-fuchsia-500/20 text-[10px] font-bold text-violet-600 dark:text-violet-300 uppercase tracking-wider border border-violet-200 dark:border-violet-500/20">
                                                        OSM Search
                                                    </span>
                                                )}
                                            </div>

                                            {/* 1. Coordinate Match */}
                                            {(() => {
                                                const parsed = parseCoordinate(searchQuery);
                                                if (parsed) {
                                                    return (
                                                        <button
                                                            onClick={() => {
                                                                const newWaypoint: Waypoint = {
                                                                    id: crypto.randomUUID(),
                                                                    name: parsed.type === 'plus_code' ? `Plus Code: ${searchQuery}` : `Loc: ${formatCoords(parsed.lat, parsed.lon)}`,
                                                                    lat: parsed.lat,
                                                                    lon: parsed.lon
                                                                };
                                                                setWaypoints(prev => [...prev, newWaypoint]);
                                                                setSearchQuery('');
                                                                setRouteCoords(null);
                                                                setAlternateRouteCoords(null);
                                                                setShowOnMap(false);
                                                                onRouteChange(null, null, null, false);
                                                                setSnappedWaypoints({});
                                                            }}
                                                            className="w-full flex items-start gap-3 p-4 text-left hover:bg-zinc-50 dark:hover:bg-white/5 active:bg-zinc-100 transition-colors border-t border-black/5 dark:border-white/5 first:border-t-0 group"
                                                        >
                                                            <div className="mt-0.5 p-2 rounded-full bg-blue-50 dark:bg-blue-500/10 text-blue-500 group-hover:text-blue-600 dark:group-hover:text-blue-400 shrink-0 transition-colors">
                                                                <MapPin size={16} />
                                                            </div>
                                                            <div className="flex-1 min-w-0">
                                                                <div className="text-sm font-semibold text-zinc-900 dark:text-white truncate">
                                                                    Add Location
                                                                </div>
                                                                <div className="text-xs text-zinc-500 dark:text-white/60 truncate">
                                                                    {parsed.lat.toFixed(6)}, {parsed.lon.toFixed(6)}
                                                                </div>
                                                            </div>
                                                        </button>
                                                    );
                                                }
                                                return null;
                                            })()}

                                            {/* 2. Saved Matches */}
                                            {savedWaypointMatches.map((match, index) => (
                                                <button
                                                    key={`saved-${index}`}
                                                    onClick={() => {
                                                        const newWaypoint: Waypoint = {
                                                            id: crypto.randomUUID(),
                                                            name: match.name,
                                                            lat: match.lat,
                                                            lon: match.lon
                                                        };
                                                        setWaypoints(prev => [...prev, newWaypoint]);
                                                        setSearchQuery('');
                                                        setRouteCoords(null);
                                                        setAlternateRouteCoords(null);
                                                        setShowOnMap(false);
                                                        onRouteChange(null, null, null, false);
                                                        setSnappedWaypoints({});
                                                    }}
                                                    className="w-full flex items-start gap-3 p-4 text-left hover:bg-zinc-50 dark:hover:bg-white/5 active:bg-zinc-100 transition-colors border-t border-black/5 dark:border-white/5 first:border-t-0 group"
                                                >
                                                    <div className="mt-0.5 p-2 rounded-full bg-emerald-50 dark:bg-emerald-500/10 text-emerald-500 group-hover:text-emerald-600 dark:group-hover:text-emerald-400 shrink-0 transition-colors">
                                                        <MapPin size={16} />
                                                    </div>
                                                    <div className="flex-1 min-w-0">
                                                        <div className="text-sm font-semibold text-zinc-900 dark:text-white truncate">
                                                            {match.name}
                                                        </div>
                                                        <div className="text-xs text-zinc-500 dark:text-white/60 truncate">
                                                            Saved from your routes
                                                        </div>
                                                    </div>
                                                </button>
                                            ))}

                                            {/* 3. Online Matches */}
                                            {onlineSuggestions.map((result) => (
                                                <button
                                                    key={result.place_id}
                                                    onClick={() => {
                                                        const newWaypoint: Waypoint = {
                                                            id: crypto.randomUUID(),
                                                            name: result.display_name.split(',')[0],
                                                            lat: parseFloat(result.lat),
                                                            lon: parseFloat(result.lon)
                                                        };
                                                        setWaypoints(prev => [...prev, newWaypoint]);
                                                        setSearchQuery('');
                                                        setRouteCoords(null);
                                                        setAlternateRouteCoords(null);
                                                        setShowOnMap(false);
                                                        onRouteChange(null, null, null, false);
                                                        setSnappedWaypoints({});
                                                    }}
                                                    className="w-full flex items-start gap-3 p-4 text-left hover:bg-zinc-50 dark:hover:bg-white/5 active:bg-zinc-100 transition-colors border-t border-black/5 dark:border-white/5 first:border-t-0 group"
                                                >
                                                    <div className="mt-0.5 p-2 rounded-full bg-violet-50 dark:bg-violet-500/10 text-violet-500 group-hover:text-violet-600 dark:group-hover:text-violet-400 shrink-0 transition-colors">
                                                        <MapPin size={16} />
                                                    </div>
                                                    <div className="flex-1 min-w-0">
                                                        <div className="text-sm font-semibold text-zinc-900 dark:text-white truncate">
                                                            {result.display_name.split(',')[0]}
                                                        </div>
                                                        <div className="text-xs text-zinc-500 dark:text-white/60 truncate">
                                                            {result.display_name.split(',').slice(1).join(',')}
                                                        </div>
                                                    </div>
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* Add Current Location Button - below search results */}
                            {currentLocation && (
                                <button
                                    onClick={() => {
                                        const newWaypoint: Waypoint = {
                                            id: crypto.randomUUID(),
                                            name: 'Current Location',
                                            lat: currentLocation[0],
                                            lon: currentLocation[1]
                                        };
                                        setWaypoints(prev => [...prev, newWaypoint]);
                                        setRouteCoords(null);
                                        setAlternateRouteCoords(null);
                                        setShowOnMap(false);
                                        onRouteChange(null, null, null, false);
                                        setSnappedWaypoints({});
                                    }}
                                    className="w-full p-3 flex items-center gap-3 rounded-2xl bg-blue-500/10 dark:bg-blue-500/20 border border-blue-500/20 transition-colors"
                                >
                                    <Navigation size={16} className="text-blue-500" />
                                    <span className="text-sm font-medium text-blue-600 dark:text-blue-400">Add Current Location</span>
                                </button>
                            )}

                            {/* Drop Pin on Map Button */}
                            <button
                                onClick={toggleDropPinMode}
                                className="w-full p-3 flex items-center gap-3 rounded-2xl bg-orange-500/10 dark:bg-orange-500/20 border border-orange-500/20 transition-colors"
                            >
                                <MapPinned size={16} className="text-orange-500" />
                                <span className="text-sm font-medium text-orange-600 dark:text-orange-400">Drop Pin on Map</span>
                            </button>
                        </div>

                        {/* Waypoints List */}
                        <div className="space-y-2 flex-1">
                            <div className="flex items-center justify-between ml-2 mr-2">
                                <label className="text-xs font-bold uppercase tracking-widest text-zinc-400 dark:text-white/20">
                                    Waypoints ({waypoints.length})
                                </label>
                                {waypoints.length > 1 && (
                                    <button
                                        onClick={reverseWaypoints}
                                        className="p-1 rounded-md transition-colors"
                                        title="Reverse Order"
                                    >
                                        <ArrowUpDown size={14} className="text-zinc-400 dark:text-white/30" />
                                    </button>
                                )}
                            </div>

                            {waypoints.length === 0 ? (
                                <div className="p-8 text-center text-zinc-400 dark:text-white/30 text-sm">
                                    No waypoints added yet.
                                </div>
                            ) : (
                                <div className="space-y-2">
                                    {waypoints.map((waypoint, index) => (
                                        <div
                                            key={waypoint.id}
                                            className="flex items-center gap-2 p-3 rounded-2xl bg-zinc-100 dark:bg-white/5 border border-black/5 dark:border-white/10"
                                        >
                                            {/* Reorder Buttons */}
                                            <div className="flex flex-col gap-0.5 -ml-1 mr-1">
                                                <button
                                                    onClick={() => moveWaypoint(index, -1)}
                                                    disabled={index === 0}
                                                    className="p-0.5 text-zinc-400 dark:text-white/30 disabled:opacity-20 outline-none focus:outline-none"
                                                    style={{ WebkitTapHighlightColor: 'transparent' }}
                                                >
                                                    <ChevronUp size={12} />
                                                </button>
                                                <button
                                                    onClick={() => moveWaypoint(index, 1)}
                                                    disabled={index === waypoints.length - 1}
                                                    className="p-0.5 text-zinc-400 dark:text-white/30 disabled:opacity-20 outline-none focus:outline-none"
                                                    style={{ WebkitTapHighlightColor: 'transparent' }}
                                                >
                                                    <ChevronDown size={12} />
                                                </button>
                                            </div>

                                            <div className="w-6 h-6 rounded-full bg-[#007AFF] text-white text-xs font-bold flex items-center justify-center shrink-0">
                                                {index + 1}
                                            </div>
                                            {editingWaypointId === waypoint.id ? (
                                                // Editing Mode: Input + Tick + X
                                                <>
                                                    <input
                                                        type="text"
                                                        value={editingName}
                                                        onChange={(e) => setEditingName(e.target.value)}
                                                        className="flex-1 min-w-0 text-sm bg-white dark:bg-white/10 rounded-lg px-2 py-1 text-zinc-700 dark:text-white border border-blue-500"
                                                        autoFocus
                                                        onFocus={(e) => e.currentTarget.select()}
                                                        onKeyDown={(e) => {
                                                            if (e.key === 'Enter') updateWaypointName(waypoint.id, editingName);
                                                            if (e.key === 'Escape') setEditingWaypointId(null);
                                                        }}
                                                    />
                                                    <button
                                                        onClick={() => updateWaypointName(waypoint.id, editingName)}
                                                        className="p-2 rounded-xl text-green-500 bg-green-500/10 transition-colors"
                                                    >
                                                        <Check size={16} />
                                                    </button>
                                                    <button
                                                        onClick={() => setEditingWaypointId(null)}
                                                        className="p-2 rounded-xl text-zinc-400 bg-zinc-500/10 transition-colors"
                                                    >
                                                        <X size={16} />
                                                    </button>
                                                </>
                                            ) : (
                                                // View Mode: Name + Pencil + Trash
                                                <>
                                                    <span className="flex-1 text-sm text-zinc-700 dark:text-white font-medium truncate">
                                                        {waypoint.name}
                                                    </span>
                                                    <button
                                                        onClick={() => startEditingWaypoint(waypoint)}
                                                        className="p-2 rounded-xl text-zinc-400 dark:text-white/40 active:scale-95 transition-transform"
                                                    >
                                                        <Pencil size={14} />
                                                    </button>
                                                    <button
                                                        onClick={() => removeWaypoint(waypoint.id)}
                                                        className="p-2 rounded-xl text-zinc-400 dark:text-white/40 active:scale-95 transition-transform"
                                                    >
                                                        <Trash2 size={16} />
                                                    </button>
                                                </>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* Show on Map Toggle */}
                        {routeCoords && (
                            <div className="flex items-center justify-between p-4 rounded-2xl bg-zinc-100 dark:bg-white/5 border border-black/5 dark:border-white/10">
                                <div className="flex items-center gap-3">
                                    {showOnMap ? <Eye size={20} className="text-blue-500" /> : <EyeOff size={20} className="text-zinc-400" />}
                                    <span className="font-medium text-zinc-700 dark:text-white">Show on Map</span>
                                </div>
                                <button
                                    onClick={toggleShowOnMap}
                                    className={`w-14 h-8 rounded-full transition-colors ${showOnMap ? 'bg-[#007AFF]' : 'bg-zinc-300 dark:bg-white/20'}`}
                                >
                                    <div className={`w-6 h-6 rounded-full bg-white shadow-md transition-transform ${showOnMap ? 'translate-x-7' : 'translate-x-1'}`} />
                                </button>
                            </div>
                        )}

                        {/* Save Route Section - shows after route is created */}
                        {routeCoords && pubkey && (
                            <div className="space-y-3 p-4 rounded-2xl bg-green-500/5 dark:bg-green-500/10 border border-green-500/20">
                                <label className="text-xs font-bold uppercase tracking-widest text-green-600 dark:text-green-400 flex items-center gap-2">
                                    <Save size={14} />
                                    Save Route
                                </label>
                                <div className="flex flex-col sm:flex-row gap-2">
                                    <input
                                        type="text"
                                        value={routeName}
                                        onChange={(e) => setRouteName(e.target.value)}
                                        placeholder="Route name (optional)"
                                        className="w-full sm:flex-1 p-3 rounded-xl bg-white dark:bg-white/5 border border-black/5 dark:border-white/10 text-zinc-700 dark:text-white placeholder-zinc-400 dark:placeholder-white/40 text-sm"
                                    />
                                    <button
                                        onClick={saveRoute}
                                        disabled={isSaving}
                                        className="w-full sm:w-auto px-6 rounded-xl bg-green-500 text-white font-bold disabled:opacity-50 transition-all active:scale-95 py-3 sm:py-0"
                                    >
                                        {isSaving ? '...' : 'Save'}
                                    </button>
                                </div>
                            </div>
                        )}

                        {/* Action Buttons */}
                        <div className="flex gap-3">
                            <button
                                onClick={clearAllWaypoints}
                                disabled={waypoints.length === 0}
                                className="flex-1 h-14 rounded-2xl bg-zinc-200 dark:bg-white/10 text-zinc-600 dark:text-white/70 font-bold disabled:opacity-50 disabled:cursor-not-allowed transition-all active:scale-95"
                            >
                                Clear Route
                            </button>
                            <button
                                onClick={createRoute}
                                disabled={waypoints.length < 2 || isCreatingRoute}
                                className="flex-1 h-14 rounded-2xl bg-[#007AFF] text-white font-bold shadow-lg shadow-[#007AFF]/20 disabled:opacity-50 disabled:cursor-not-allowed transition-all active:scale-95"
                            >
                                {isCreatingRoute ? 'Creating...' : 'Create Route'}
                            </button>
                        </div>

                        {/* Hint about save option */}
                        {!routeCoords && waypoints.length >= 2 && pubkey && (
                            <p className="text-xs text-center text-zinc-400 dark:text-white/40">
                                💾 Save option will appear after you create the route
                            </p>
                        )}

                        {/* Saved Routes Section */}
                        {pubkey && (
                            <div className="space-y-3 border-t border-black/5 dark:border-white/10 pt-4">
                                <button
                                    onClick={() => setShowSavedRoutes(!showSavedRoutes)}
                                    className="w-full flex items-center justify-between"
                                >
                                    <div className="flex items-center gap-2">
                                        <FolderOpen size={18} className="text-zinc-500 dark:text-white/50" />
                                        <span className="text-xs font-bold uppercase tracking-widest text-zinc-400 dark:text-white/20">
                                            Saved Routes ({savedRoutes.length})
                                        </span>
                                    </div>
                                    <span className="text-xs text-zinc-400 dark:text-white/40">
                                        {showSavedRoutes ? 'Hide' : 'Show'}
                                    </span>
                                </button>

                                {showSavedRoutes && (
                                    <div className="space-y-2">
                                        {isLoadingSaved ? (
                                            <div className="text-center text-zinc-400 dark:text-white/40 text-sm py-4">
                                                Loading...
                                            </div>
                                        ) : savedRoutes.length === 0 ? (
                                            <div className="text-center text-zinc-400 dark:text-white/40 text-sm py-4">
                                                No saved routes yet
                                            </div>
                                        ) : (
                                            savedRoutes.map((route) => (
                                                <div
                                                    key={route.id}
                                                    className="flex items-center justify-between p-3 rounded-xl bg-zinc-100 dark:bg-white/5 border border-black/5 dark:border-white/10"
                                                >
                                                    <button
                                                        onClick={() => loadRoute(route)}
                                                        className="flex-1 text-left"
                                                    >
                                                        <div className="font-medium text-sm text-zinc-700 dark:text-white truncate">
                                                            {route.decryptedContent.name}
                                                        </div>
                                                        <div className="flex items-center gap-2 text-xs text-zinc-400 dark:text-white/40">
                                                            <span>{route.decryptedContent.waypoints.length} stops</span>
                                                            <span>•</span>
                                                            <Clock size={12} />
                                                            <span>{new Date(route.created_at * 1000).toLocaleDateString()}</span>
                                                        </div>
                                                    </button>
                                                    <button
                                                        onClick={() => deleteRoute(route)}
                                                        className="p-2 rounded-lg text-zinc-400 dark:text-white/40 active:scale-95 transition-transform"
                                                    >
                                                        <Trash2 size={16} />
                                                    </button>
                                                </div>
                                            ))
                                        )}
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Tip Message */}
                        <div className="p-3 rounded-xl bg-amber-500/10 dark:bg-amber-500/5 border border-amber-500/20">
                            <p className="text-xs text-amber-700 dark:text-amber-400/80 leading-relaxed">
                                <strong>Tip:</strong> If place name does not return results, use coordinate or Google Maps plus code in waypoint search. Edit waypoint names to label locations. When you save routes, waypoint names become searchable.
                            </p>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
};
