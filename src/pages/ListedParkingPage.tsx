
/**
 * Listed Parking Page - Fullscreen page for managing and discovering listed parking spots
 * Refined based on user feedback (Style, Form, Features)
 */
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { MapPin, Plus, Trash2, X, Check, Copy, Pencil, ChevronRight, LocateFixed, Users, ArrowLeft, Search, RotateCw, EyeOff, Ban, MoreVertical, Star, Info } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { KINDS, DEFAULT_RELAYS, APPROVER_PUBKEY } from '../lib/nostr';
import { getSuggestions, type NominatimResult, calculateDistance, encodeGeohash } from '../lib/geo';
import { decryptParkingLog } from '../lib/encryption';
import type { RouteLogContent } from '../lib/nostr';
import { getCurrencyFromLocation, getCurrencySymbol } from '../lib/currency'; // Import currency utility
import * as nip19 from 'nostr-tools/nip19';
import { relayHealthMonitor } from '../lib/relayHealth';
import { QRCodeSVG } from 'qrcode.react';

const yieldToMain = () => new Promise(resolve => setTimeout(resolve, 50));

// Types for Listed Parking
export interface ListedParkingMetadata {
    id: string;
    pubkey?: string;
    d: string;
    listing_name: string;
    location: string;
    g: string;
    floors?: string;
    floor_plan?: any[];
    total_spots?: number;
    rates?: Record<string, { hourly: number; currency: string }>;
    listing_type: 'public' | 'private';
    qr_type?: 'static' | 'dynamic';
    status?: 'open' | 'closed';
    owners: string[];
    managers: string[];
    members: string[];
    relays?: string[];
    local_area?: string;
    city?: string;
    zipcode?: string;
    created_at?: number;
    originalEvent?: any;
}

export interface ParkingSpotListing {
    id: string;
    pubkey: string;
    d: string;
    a: string;
    spot_number: string;
    floor?: string;
    short_name?: string;
    type: 'bicycle' | 'motorcycle' | 'car';
    location: string;
    g: string;
    content: string;
    rates?: { hourly: number; currency: string };
}

export interface SpotStatus {
    id: string;
    pubkey: string;
    a: string;
    status: 'occupied' | 'open' | 'closed';
    updated_by: string;
    authorizer?: string;
    created_at: number;
}

export interface ParkingSnapshot {
    listing_id: string;
    g?: string;
    stats: {
        car: { open: number; occupied: number; total: number; closed: number; rate: number };
        motorcycle: { open: number; occupied: number; total: number; closed: number; rate: number };
        bicycle: { open: number; occupied: number; total: number; closed: number; rate: number };
    };
    last_updated: number;
}

interface ListedParkingPageProps {
    onClose: () => void;
    currentLocation?: [number, number] | null;
    countryCode?: string | null;
    onPickLocation?: () => void;
    pickedLocation?: { lat: number, lon: number } | null;
    routeWaypoints?: { lat: number; lon: number }[];
    isVisible: boolean; // Control scroll lock and other active effects
}

type TabType = 'public' | 'private' | 'my';


export interface SavedRoute {
    id: string;
    dTag: string;
    decryptedContent: RouteLogContent;
    created_at: number;
}

// Info Tooltip Component (click-based for mobile)
const InfoTooltip: React.FC<{ text: string; title?: string }> = ({ text, title }) => {
    const [show, setShow] = useState(false);

    const handleClose = (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setShow(false);
    };

    return (
        <span className="inline-flex items-center ml-1" style={{ verticalAlign: 'middle' }}>
            <button
                type="button"
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); setShow(true); }}
                className="appearance-none border-0 bg-transparent p-0 m-0 cursor-pointer inline-flex items-center"
                style={{ lineHeight: 0 }}
            >
                <Info size={11} className="text-zinc-400" />
            </button>
            {show && (
                <div
                    className="fixed inset-0 z-[9999] bg-black/60 flex items-center justify-center p-4"
                    onClick={handleClose}
                >
                    <div
                        className="relative max-w-xs w-full p-5 bg-white dark:bg-zinc-800 rounded-2xl shadow-2xl border border-black/5 dark:border-white/10"
                        onClick={(e) => e.stopPropagation()}
                    >
                        {title && <h3 className="text-xs font-bold uppercase text-zinc-500 dark:text-zinc-400 mb-2 pr-6">{title}</h3>}
                        <p className="text-zinc-700 dark:text-white text-sm font-normal normal-case leading-relaxed m-0 pr-4">{text}</p>
                        <button
                            type="button"
                            className="absolute top-3 right-3 w-7 h-7 bg-zinc-100 dark:bg-zinc-700 rounded-full flex items-center justify-center hover:bg-zinc-200 dark:hover:bg-zinc-600 transition-colors"
                            onClick={handleClose}
                        >
                            <X size={18} className="text-zinc-500 dark:text-white" />
                        </button>
                    </div>
                </div>
            )}
        </span>
    );
};

export const ListedParkingPage: React.FC<ListedParkingPageProps> = ({ onClose, currentLocation, countryCode, onPickLocation, pickedLocation, isVisible }) => {
    const { pubkey, pool, signEvent } = useAuth();
    const [activeTab, setActiveTab] = useState<TabType>('public');
    const [selectedListing, setSelectedListing] = useState<ListedParkingMetadata | null>(null);
    const [showCreateForm, setShowCreateForm] = useState(false);
    const [isLoading, setIsLoading] = useState(() => {
        // Lazy init: Check if we can skip loading (data already cached)
        if (!currentLocation) return true; // No location yet, need to load
        const currentHash = encodeGeohash(currentLocation[0], currentLocation[1], 5);
        const lastFetchedHash = sessionStorage.getItem('parlens_last_fetch_hash');
        return lastFetchedHash !== currentHash; // Load if hash changed
    });
    const [statusLoading, setStatusLoading] = useState(() => {
        // Lazy init: Same logic as isLoading
        if (!currentLocation) return true;
        const currentHash = encodeGeohash(currentLocation[0], currentLocation[1], 5);
        const lastFetchedHash = sessionStorage.getItem('parlens_last_fetch_hash');
        return lastFetchedHash !== currentHash;
    });
    const [listings, setListings] = useState<ListedParkingMetadata[]>([]);
    const [spots, setSpots] = useState<ParkingSpotListing[]>([]);
    const [spotStatuses, setSpotStatuses] = useState<Map<string, SpotStatus>>(new Map());
    const [spotToListingMap, setSpotToListingMap] = useState<Map<string, { listingId: string; type: 'car' | 'motorcycle' | 'bicycle' }>>(new Map()); // d-tag -> {listingId, type} for global sync
    const [selectedSpot, setSelectedSpot] = useState<ParkingSpotListing | null>(null);
    const [editingListing, setEditingListing] = useState<ListedParkingMetadata | null>(null);
    const [isDeleting, setIsDeleting] = useState(false);
    const [vehicleFilter, setVehicleFilter] = useState<'all' | 'car' | 'motorcycle' | 'bicycle'>('all');
    const [searchTerm, setSearchTerm] = useState('');
    const [confirmedSearchTerm, setConfirmedSearchTerm] = useState(''); // Applied on search button click
    const [listingStats, setListingStats] = useState<Map<string, {
        car: { open: number; occupied: number; closed: number; total: number; rate: number };
        motorcycle: { open: number; occupied: number; closed: number; total: number; rate: number };
        bicycle: { open: number; occupied: number; closed: number; total: number; rate: number };
    }>>(new Map());
    const [showAccessListModal, setShowAccessListModal] = useState<ListedParkingMetadata | null>(null);
    const [floorFilter, setFloorFilter] = useState<string>('all');
    const [statusFilter, setStatusFilter] = useState<'all' | 'open' | 'occupied' | 'closed'>('all');
    const [isTogglingStatus, setIsTogglingStatus] = useState(false);
    const [displayedCount, setDisplayedCount] = useState(10); // Pagination - show 10 at a time
    const [showHideMenu, setShowHideMenu] = useState<string | null>(null); // Listing ID for dropdown
    const [savedListings, setSavedListings] = useState<Set<string>>(() => {
        try {
            const saved = localStorage.getItem('parlens-saved-listings');
            return saved ? new Set(JSON.parse(saved)) : new Set();
        } catch { return new Set(); }
    });
    const [showSavedOnly, setShowSavedOnly] = useState(false);

    // Approval Workflow State
    const isApprover = pubkey === APPROVER_PUBKEY;
    const [approvalLabels, setApprovalLabels] = useState<Map<string, string>>(() => new Map()); // listingATag -> approval event ID
    // Approver filter: 'all' | 'my' | 'approved' | 'pending'
    const [approverFilter, setApproverFilter] = useState<'all' | 'my' | 'approved' | 'pending'>('all');
    const [isApprovingListing, setIsApprovingListing] = useState(false);
    // User's My Listings filter: 'all' | 'approved' | 'pending'
    const [myListingsStatusFilter, setMyListingsStatusFilter] = useState<'all' | 'approved' | 'pending'>('all');

    // Captured location - set once on mount and updated only on explicit refresh
    const capturedLocationRef = useRef<[number, number] | null>(null);
    const hasFetchedRef = useRef(false); // Tracks if initial fetch has occurred

    const toggleSaved = (listingId: string) => {
        setSavedListings(prev => {
            const next = new Set(prev);
            if (next.has(listingId)) next.delete(listingId);
            else next.add(listingId);
            localStorage.setItem('parlens-saved-listings', JSON.stringify(Array.from(next)));
            return next;
        });
    };

    // Approve or revoke listing approval (approver only)
    const toggleListingApproval = useCallback(async (listing: ListedParkingMetadata) => {
        if (!pool || !signEvent || !isApprover) return;

        const listingATag = `${KINDS.LISTED_PARKING_METADATA}:${listing.pubkey}:${listing.d}`;
        const isApproved = approvalLabels.has(listingATag);

        setIsApprovingListing(true);
        try {
            if (isApproved) {
                // Revoke approval - publish Kind 5 delete event
                const existingEventId = approvalLabels.get(listingATag);
                if (existingEventId) {
                    const deleteEvent = {
                        kind: 5,
                        created_at: Math.floor(Date.now() / 1000),
                        tags: [['e', existingEventId]],
                        content: 'Revoking listing approval'
                    };
                    const signedDelete = await signEvent(deleteEvent);
                    await Promise.allSettled(pool.publish(DEFAULT_RELAYS, signedDelete));

                    // Update local state
                    setApprovalLabels(prev => {
                        const newMap = new Map(prev);
                        newMap.delete(listingATag);
                        return newMap;
                    });
                }
            } else {
                // Approve - publish Kind 1985 Label event
                const labelEvent = {
                    kind: KINDS.LABEL,
                    created_at: Math.floor(Date.now() / 1000),
                    tags: [
                        ['l', 'approved', 'parlens'],
                        ['a', listingATag],
                        ['p', listing.pubkey || '']
                    ],
                    content: 'Approved public listing'
                };
                const signedLabel = await signEvent(labelEvent);
                await Promise.allSettled(pool.publish(DEFAULT_RELAYS, signedLabel));

                // Update local state
                setApprovalLabels(prev => {
                    const newMap = new Map(prev);
                    newMap.set(listingATag, signedLabel.id);
                    return newMap;
                });
            }
        } catch (e) {
            console.error('[Parlens] Failed to toggle approval:', e);
            alert('Failed to update approval. Please try again.');
        } finally {
            setIsApprovingListing(false);
        }
    }, [pool, signEvent, isApprover, approvalLabels]);

    // Hidden items with human-readable names - unified structure
    interface HiddenItem {
        id: string;
        name: string;
        type: 'listing' | 'owner';
    }
    const [hiddenItems, setHiddenItems] = useState<HiddenItem[]>([]);

    // Search Center - defaults to current location, updated by search
    const [searchCenter, setSearchCenter] = useState<[number, number] | null>(null);
    const [suggestions, setSuggestions] = useState<NominatimResult[]>([]);
    const [isSuggesting, setIsSuggesting] = useState(false);
    const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Initialize search center on mount
    useEffect(() => {
        if (currentLocation && !searchCenter) {
            setSearchCenter(currentLocation);
            setSuggestions([]); // Clear suggestions on mount
        }
    }, [currentLocation]);

    // Lock body scroll when this page is mounted AND visible (prevents iOS scroll issues)
    useEffect(() => {
        if (!isVisible) return; // Only lock if visible

        const originalOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => {
            document.body.style.overflow = originalOverflow;
        };
    }, [isVisible]);

    // Fetch approval labels from approver on mount
    useEffect(() => {
        if (!pool) return;

        const fetchApprovalLabels = async () => {
            try {
                const approvalEvents = await pool.querySync(DEFAULT_RELAYS, {
                    kinds: [KINDS.LABEL],
                    authors: [APPROVER_PUBKEY],
                    '#l': ['approved']
                } as any);

                const labels = new Map<string, string>();
                for (const event of approvalEvents) {
                    const aTag = event.tags.find((t: string[]) => t[0] === 'a')?.[1];
                    if (aTag) {
                        // Keep most recent approval for each listing
                        const existing = labels.get(aTag);
                        if (!existing) {
                            labels.set(aTag, event.id);
                        }
                    }
                }

                setApprovalLabels(labels);
            } catch (e) {
                console.error('[Parlens] Failed to fetch approval labels:', e);
            }
        };

        fetchApprovalLabels();
    }, [pool]);

    const [savedRoutes, setSavedRoutes] = useState<SavedRoute[]>([]);

    // Load saved routes on mount
    useEffect(() => {
        const loadSavedRoutes = async () => {
            try {
                const saved = localStorage.getItem('parlens-saved-routes');
                if (saved) {
                    const parsed = JSON.parse(saved);
                    const decrypted = await Promise.all(parsed.map(async (item: any) => {
                        try {
                            if (!pubkey) return null;
                            const content = await decryptParkingLog(item.content, pubkey);
                            return {
                                id: item.id,
                                dTag: item.dTag,
                                decryptedContent: content,
                                created_at: item.created_at
                            };
                        } catch (e) {
                            return null;
                        }
                    }));
                    setSavedRoutes(decrypted.filter(Boolean) as SavedRoute[]);
                }
            } catch (e) {
                console.error('Error loading saved routes:', e);
            }
        };
        loadSavedRoutes();
    }, [pubkey]);

    // Derived saved matches
    const savedMatches = useMemo(() => {
        if (!searchTerm || searchTerm.length < 2) return [];
        const query = searchTerm.toLowerCase();
        const matches: Array<{ name: string; lat: number; lon: number }> = [];

        for (const route of savedRoutes) {
            for (const wp of route.decryptedContent.waypoints) {
                if (wp.name.toLowerCase().includes(query)) {
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
        return matches.slice(0, 3);
    }, [searchTerm, savedRoutes]);

    // Derived locality matches - search listings by locality/city
    const listingMatches = useMemo(() => {
        if (!searchTerm || searchTerm.length < 2) return [];
        const query = searchTerm.toLowerCase();
        const matches: Array<{ name: string; lat: number; lon: number }> = [];
        const seenLocalities = new Set<string>();

        for (const listing of listings) {
            const locality = listing.local_area || listing.city;
            if (!locality) continue;

            const localityMatch = locality.toLowerCase().includes(query);
            if (localityMatch && !seenLocalities.has(locality.toLowerCase())) {
                // Parse location for coordinates (use first listing as representative)
                const [lat, lon] = (listing.location || '').split(',').map(Number);
                if (!isNaN(lat) && !isNaN(lon)) {
                    seenLocalities.add(locality.toLowerCase());
                    matches.push({
                        name: locality,
                        lat,
                        lon
                    });
                }
            }
        }
        return matches.slice(0, 3);
    }, [searchTerm, listings]);
    // Handle Input Change & Debounce Search
    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const val = e.target.value;
        setSearchTerm(val);

        if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);

        if (val.length < 3) {
            setSuggestions([]);
            return;
        }

        // Debounce suggestion fetch
        searchTimeoutRef.current = setTimeout(async () => {
            setIsSuggesting(true);
            const results = await getSuggestions(val, countryCode, currentLocation, 1);
            setSuggestions(results);
            setIsSuggesting(false);
        }, 500); // 500ms debounce
    };

    // Confirm a suggestion from the list
    const handleSelectSuggestion = (item: NominatimResult) => {
        const lat = parseFloat(item.lat);
        const lon = parseFloat(item.lon);


        if (!isNaN(lat) && !isNaN(lon)) {
            setSearchCenter([lat, lon]);
            capturedLocationRef.current = [lat, lon];
            setConfirmedSearchTerm(''); // Clear text filter to sorting mode
            setSearchTerm(item.display_name.split(',')[0]); // Show short name in input
            setSuggestions([]);
            fetchListings(); // Trigger refresh with new location context
        }
    };

    // Generic Search (Enter Key) - falls back to first suggestion or manual search
    const handleSearch = async () => {
        if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);

        // If we have suggestions, pick the first one
        if (suggestions.length > 0) {
            handleSelectSuggestion(suggestions[0]);
            return;
        }

        if (!searchTerm) {
            setConfirmedSearchTerm('');
            if (currentLocation) {
                setSearchCenter(currentLocation);
                capturedLocationRef.current = currentLocation;
            }
            setSuggestions([]);
            fetchListings(); // Refresh with current location
            return;
        }

        setIsSuggesting(true);
        try {
            // 1. Try Online Search (Location/Place)
            const result = await getSuggestions(searchTerm, countryCode, currentLocation, 1); // Limit to 1 for direct search

            if (result && result.length > 0) {
                const lat = parseFloat(result[0].lat);
                const lon = parseFloat(result[0].lon);
                if (!isNaN(lat) && !isNaN(lon)) {
                    setSearchCenter([lat, lon]);
                    capturedLocationRef.current = [lat, lon];
                    setConfirmedSearchTerm('');
                    setSuggestions([]);
                    setIsLoading(false);
                    fetchListings(); // Refresh with new searched location
                    return;
                }
            }

            // 2. Fallback: Text Filter
            if (searchTerm.length > 2) {
                // Limit to 1 result to match Waypoint Search
                const fallbackSuggestions = await getSuggestions(searchTerm, countryCode, currentLocation, 1);
                if (fallbackSuggestions.length > 0) {
                    handleSelectSuggestion(fallbackSuggestions[0]);
                    setIsLoading(false);
                    return;
                }
            }
            setConfirmedSearchTerm(searchTerm);
            if (currentLocation) setSearchCenter(currentLocation);
            // No fetchListings here - just filtering existing results by text
            setSuggestions([]);
        } catch (e) {
            console.error('Search failed:', e);
            // Fallback to text filter on error
            setConfirmedSearchTerm(searchTerm);
        } finally {
            setIsSuggesting(false);
            setIsLoading(false);
        }
    };

    useEffect(() => {
        try {
            const saved = localStorage.getItem('parlens-hidden-items');
            if (saved) {
                setHiddenItems(JSON.parse(saved));
            } else {
                // Migrate old format if exists
                const oldListings = JSON.parse(localStorage.getItem('parlens-hidden-listings') || '[]');
                const oldPubkeys = JSON.parse(localStorage.getItem('parlens-blocked-pubkeys') || '[]');
                const migrated: HiddenItem[] = [
                    ...oldListings.map((id: string) => ({ id, name: 'Unknown Listing', type: 'listing' as const })),
                    ...oldPubkeys.map((id: string) => ({ id, name: id.slice(0, 12) + '...', type: 'owner' as const }))
                ];
                if (migrated.length > 0) {
                    setHiddenItems(migrated);
                    localStorage.setItem('parlens-hidden-items', JSON.stringify(migrated));
                    localStorage.removeItem('parlens-hidden-listings');
                    localStorage.removeItem('parlens-blocked-pubkeys');
                }
            }
        } catch (e) { }

        // Listen for storage changes (cross-tab and custom event)
        const handleStorageChange = () => {
            const saved = localStorage.getItem('parlens-hidden-items');
            if (saved) setHiddenItems(JSON.parse(saved));
        };
        window.addEventListener('storage', handleStorageChange);
        window.addEventListener('parlens-hidden-items-updated', handleStorageChange);
        return () => {
            window.removeEventListener('storage', handleStorageChange);
            window.removeEventListener('parlens-hidden-items-updated', handleStorageChange);
        };
    }, []);

    const hideListing = (id: string, name: string) => {
        if (hiddenItems.some(h => h.id === id)) return; // Already hidden
        const next = [...hiddenItems, { id, name, type: 'listing' as const }];
        setHiddenItems(next);
        localStorage.setItem('parlens-hidden-items', JSON.stringify(next));
        window.dispatchEvent(new Event('parlens-hidden-items-updated'));
        setShowHideMenu(null);
    };

    // Global click listener to close menu (replacing backdrop)
    useEffect(() => {
        if (!showHideMenu) return;
        const handleClick = () => setShowHideMenu(null);
        window.addEventListener('click', handleClick);
        return () => window.removeEventListener('click', handleClick);
    }, [showHideMenu]);

    const hideOwner = (pubkey: string, ownerName: string) => {
        if (hiddenItems.some(h => h.id === pubkey)) return; // Already hidden
        const next = [...hiddenItems, { id: pubkey, name: ownerName, type: 'owner' as const }];
        setHiddenItems(next);
        localStorage.setItem('parlens-hidden-items', JSON.stringify(next));
        window.dispatchEvent(new Event('parlens-hidden-items-updated'));
        setShowHideMenu(null);
    };

    // Helper to check if listing or owner is hidden
    const isHidden = (listingId: string, ownerPubkey?: string) => {
        return hiddenItems.some(h => h.id === listingId || (ownerPubkey && h.id === ownerPubkey));
    };


    // Fetch listings and their stats - PROGRESSIVE LOADING
    const fetchListings = useCallback(async (arg?: boolean | unknown) => {
        if (!pool) return;
        const silent = typeof arg === 'boolean' ? arg : false;

        if (!silent) {
            setIsLoading(true);
            setStatusLoading(true);
        }

        try {
            // 1. Fetch Metadata - Two-phase: User's listings first (always reliable), then public
            let rawEvents: any[] = [];

            // Phase A: Fetch listings where user is Author, Manager ('write'), or Member ('read')
            // This ensures "my stuff" (and shared stuff) always loads regardless of relay traffic
            if (pubkey) {
                const phaseAStart = Date.now();

                // Own listings
                const myEventsPromise = pool.querySync(DEFAULT_RELAYS, {
                    kinds: [KINDS.LISTED_PARKING_METADATA],
                    authors: [pubkey]
                });

                // Listings where I am tagged (admin, write, or read)
                // Note: '#p' catches all p-tags regardless of marker (admin/write/read)
                const taggedEventsPromise = pool.querySync(DEFAULT_RELAYS, {
                    kinds: [KINDS.LISTED_PARKING_METADATA],
                    '#p': [pubkey]
                });

                const [myEvents, taggedEvents] = await Promise.all([myEventsPromise, taggedEventsPromise]);
                const phaseALatency = Date.now() - phaseAStart;
                DEFAULT_RELAYS.forEach(relay => relayHealthMonitor.recordSuccess(relay, phaseALatency));

                // Merge and dedup Phase A
                const phaseAMap = new Map();
                [...myEvents, ...taggedEvents].forEach(e => phaseAMap.set(e.id, e));
                rawEvents = Array.from(phaseAMap.values());
            }

            // Yield before Phase B
            await yieldToMain();

            // Phase B: Fetch Saved Listings (via a-tag references)
            // Users save a-tag refs like "31147:pubkey:d-tag" in localStorage
            try {
                const savedRefs = JSON.parse(localStorage.getItem('parlens-saved-refs') || '[]') as string[];
                if (savedRefs.length > 0) {
                    const phaseBStart = Date.now();
                    const savedEvents = await pool.querySync(DEFAULT_RELAYS, {
                        kinds: [KINDS.LISTED_PARKING_METADATA],
                        '#a': savedRefs
                    });
                    const phaseBLatency = Date.now() - phaseBStart;
                    DEFAULT_RELAYS.forEach(relay => relayHealthMonitor.recordSuccess(relay, phaseBLatency));

                    // Merge saved events, avoiding duplicates
                    const existingIds = new Set(rawEvents.map((e: any) => e.id));
                    savedEvents.forEach((e: any) => {
                        if (!existingIds.has(e.id)) {
                            rawEvents.push(e);
                            existingIds.add(e.id);
                        }
                    });
                }
            } catch (e) {
                DEFAULT_RELAYS.forEach(relay => relayHealthMonitor.recordFailure(relay));
                console.warn('[Parlens] Phase B: Failed to fetch saved refs:', e);
            }

            // Yield before Phase C
            await yieldToMain();

            // Phase C: Fetch public listings (Hierarchical Geohash ONLY)
            // Note: Route display on map is handled by FAB, not here
            // Use user's 1-10 digit geohash prefixes to match listings with similar tags
            let searchLoc = capturedLocationRef.current;
            if (searchCenter) searchLoc = searchCenter;

            let publicEvents: any[] = [];

            if (searchLoc) {
                const [lat, lon] = searchLoc;
                const fullGeohash = encodeGeohash(lat, lon, 10);

                // Generate 1-10 character prefixes for hierarchical matching
                const geohashPrefixes: string[] = [];
                for (let i = 1; i <= 10; i++) {
                    geohashPrefixes.push(fullGeohash.substring(0, i));
                }

                // Query with all prefixes - listings with matching g-tags at ANY level will be found
                const phaseCStart = Date.now();
                publicEvents = await pool.querySync(DEFAULT_RELAYS, {
                    kinds: [KINDS.LISTED_PARKING_METADATA],
                    '#g': geohashPrefixes,
                    limit: 100
                });
                const phaseCLatency = Date.now() - phaseCStart;
                DEFAULT_RELAYS.forEach(relay => relayHealthMonitor.recordSuccess(relay, phaseCLatency));

                // Fallback to global if hierarchical query returns nothing
                if (publicEvents.length === 0) {
                    publicEvents = await pool.querySync(DEFAULT_RELAYS, {
                        kinds: [KINDS.LISTED_PARKING_METADATA],
                        limit: 100
                    });
                }
            } else {
                publicEvents = await pool.querySync(DEFAULT_RELAYS, {
                    kinds: [KINDS.LISTED_PARKING_METADATA],
                    limit: 100
                });
            }

            // Yield before Phase D
            await yieldToMain();

            // Phase D: (Approver Only) Fetch recent global public listings
            // This ensures approver sees pending listings even if outside their current geohash area
            let approverEvents: any[] = [];
            if (isApprover) {
                try {
                    approverEvents = await pool.querySync(DEFAULT_RELAYS, {
                        kinds: [KINDS.LISTED_PARKING_METADATA],
                        limit: 100 // Fetch recent 100 public listings for moderation
                    });
                } catch (e) {
                    console.warn('[Parlens] Phase D failed:', e);
                }
            }

            // Yield before processing
            await yieldToMain();

            // Merge all events
            const allEvents = [...rawEvents, ...publicEvents, ...approverEvents];

            // Deduplicate by ID
            const uniqueEvents = new Map<string, any>();
            allEvents.forEach(e => {
                if (!uniqueEvents.has(e.id)) {
                    uniqueEvents.set(e.id, e);
                }
            });

            // Deduplicate events (Addressable Kind 31147) - Keep only latest per d-tag
            const uniqueEventsMap = new Map<string, any>();
            Array.from(uniqueEvents.values()).forEach((ev: any) => { // Use the ID-deduplicated events for d-tag deduplication
                const d = ev.tags.find((t: string[]) => t[0] === 'd')?.[1];
                if (!d) return;

                // Basic filter: Content should not be 'Deleted'
                if (ev.content === 'Deleted') return;

                const key = `${ev.pubkey}:${d}`;
                if (!uniqueEventsMap.has(key) || uniqueEventsMap.get(key).created_at < ev.created_at) {
                    uniqueEventsMap.set(key, ev);
                }
            });

            const parsedListings: ListedParkingMetadata[] = Array.from(uniqueEventsMap.values()).map((event: any) => {
                const getTagValue = (name: string) => event.tags.find((t: string[]) => t[0] === name)?.[1] || '';
                const getTagValues = (name: string) => event.tags.filter((t: string[]) => t[0] === name).map((t: string[]) => t[1]);

                const owners = event.tags.filter((t: string[]) => t[0] === 'p' && t[2] === 'admin').map((t: string[]) => t[1]);
                const managers = event.tags.filter((t: string[]) => t[0] === 'p' && t[2] === 'write').map((t: string[]) => t[1]);
                const members = event.tags.filter((t: string[]) => t[0] === 'p' && t[2] === 'read').map((t: string[]) => t[1]);
                const relays = getTagValues('relay');
                const fp = getTagValue('floor_plan');
                const floorPlan = fp ? JSON.parse(fp) : undefined;

                let rates;
                try {
                    const ratesStr = getTagValue('rates');
                    if (ratesStr) rates = JSON.parse(ratesStr);
                } catch { }

                return {
                    id: event.id,
                    pubkey: event.pubkey,
                    d: getTagValue('d'),
                    listing_name: getTagValue('listing_name') || 'Unnamed',
                    location: getTagValue('location'),
                    g: getTagValue('g'),
                    floors: getTagValue('floors'),
                    floor_plan: floorPlan,
                    total_spots: parseInt(getTagValue('total_spots') || '0'),
                    rates,
                    listing_type: (getTagValue('listing_type') as 'public' | 'private') || 'public',
                    qr_type: (getTagValue('qr_type') as 'static' | 'dynamic') || 'static',
                    status: (getTagValue('status') as 'open' | 'closed') || 'open',
                    owners,
                    managers,
                    members,
                    relays,
                    local_area: getTagValue('local_area'),
                    city: getTagValue('city'),
                    zipcode: getTagValue('zipcode'),
                    created_at: event.created_at,
                    originalEvent: event
                };
            })
                .filter(l => l.listing_name !== 'Unnamed' && l.listing_name.trim() !== '');

            // Sort by geohash proximity (prefix match), then by creation time
            let sortedListings = parsedListings;
            const sortLocation = capturedLocationRef.current;
            if (sortLocation) {
                const userGeohash = encodeGeohash(sortLocation[0], sortLocation[1], 5);
                sortedListings = parsedListings.sort((a, b) => {
                    const gA = a.g || '';
                    const gB = b.g || '';
                    const matchA = gA.startsWith(userGeohash);
                    const matchB = gB.startsWith(userGeohash);
                    // Priority: Matching geohash first, then by created_at (newest first)
                    if (matchA && !matchB) return -1;
                    if (!matchA && matchB) return 1;
                    return (b.created_at || 0) - (a.created_at || 0);
                });
            } else {
                sortedListings = parsedListings.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
            }

            setListings(sortedListings);
            setIsLoading(false); // Immediately show cards

            // 2. Progressive Stats Fetching - per listing batch (isolated error handling)
            try {
                const BATCH_SIZE = 10;

                for (let i = 0; i < sortedListings.length; i += BATCH_SIZE) {
                    const batchListings = sortedListings.slice(i, i + BATCH_SIZE);

                    // Generate parent listing addresses (root tags) for Kind 1714 query
                    // This uses the Explicit Entity model - we query by parent, not by predicted spot IDs
                    const listingATags: string[] = batchListings.map(listing =>
                        `${KINDS.LISTED_PARKING_METADATA}:${listing.pubkey}:${listing.d}`
                    );

                    if (listingATags.length === 0) continue;

                    // Fetch Kind 1714 status logs for all spots in these listings (via root tag)
                    const statusQueryStart = Date.now();
                    const statusEvents = await pool.querySync(DEFAULT_RELAYS, {
                        kinds: [KINDS.LISTED_SPOT_LOG],
                        '#a': listingATags
                    });
                    const statusQueryLatency = Date.now() - statusQueryStart;
                    DEFAULT_RELAYS.forEach(relay => relayHealthMonitor.recordSuccess(relay, statusQueryLatency));

                    // Create map of latest status per spot (keyed by spot a-tag)
                    const latestStatusMap = new Map();
                    statusEvents.forEach((e: any) => {
                        // Find the spot a-tag (first 'a' tag that points to Kind 37141)
                        const a = e.tags.find((t: string[]) => t[0] === 'a' && t[1]?.startsWith(`${KINDS.PARKING_SPOT_LISTING}:`))?.[1];
                        if (!a) return;
                        if (!latestStatusMap.has(a) || latestStatusMap.get(a).created_at < e.created_at) {
                            latestStatusMap.set(a, e);
                        }
                    });

                    // Calculate stats for each listing based on ACTUAL spots found (Explicit Entity model)
                    const batchStats = new Map<string, any>();

                    // Initialize stats for all listings in batch
                    batchListings.forEach(listing => {
                        batchStats.set(listing.d, {
                            car: { open: 0, occupied: 0, closed: 0, total: 0, rate: listing.rates?.car?.hourly || 0 },
                            motorcycle: { open: 0, occupied: 0, closed: 0, total: 0, rate: listing.rates?.motorcycle?.hourly || 0 },
                            bicycle: { open: 0, occupied: 0, closed: 0, total: 0, rate: listing.rates?.bicycle?.hourly || 0 }
                        });
                    });

                    // Iterate through actual found spots and accumulate stats
                    latestStatusMap.forEach((statusEvent) => {
                        // Find which listing this spot belongs to (from root a-tag)
                        const rootTag = statusEvent.tags.find((t: string[]) => t[0] === 'a' && t[3] === 'root')?.[1];
                        if (!rootTag) return;

                        // Extract listing d from root tag: "31147:pubkey:listingD"
                        const listingD = rootTag.split(':')[2];
                        const stats = batchStats.get(listingD);
                        if (!stats) return;

                        const status = statusEvent.tags.find((t: string[]) => t[0] === 'status')?.[1] || 'open';
                        const type = (statusEvent.tags.find((t: string[]) => t[0] === 'type')?.[1] as 'car' | 'motorcycle' | 'bicycle') || 'car';

                        if (stats[type]) {
                            stats[type].total++;
                            if (status === 'occupied') stats[type].occupied++;
                            else if (status === 'closed') stats[type].closed++;
                            else stats[type].open++;
                        }
                    });

                    // Build spot mapping from actual found spots (Explicit Entity model)
                    const batchMapping = new Map<string, { listingId: string; type: 'car' | 'motorcycle' | 'bicycle' }>();
                    latestStatusMap.forEach((statusEvent, spotATag) => {
                        // Extract spot ID from spotATag: "37141:pubkey:spotId"
                        const spotId = spotATag.split(':')[2];
                        // Find which listing this spot belongs to (from root a-tag)
                        const rootTag = statusEvent.tags.find((t: string[]) => t[0] === 'a' && t[3] === 'root')?.[1];
                        if (!rootTag) return;
                        const listingD = rootTag.split(':')[2];
                        const type = (statusEvent.tags.find((t: string[]) => t[0] === 'type')?.[1] as 'car' | 'motorcycle' | 'bicycle') || 'car';
                        batchMapping.set(spotId, { listingId: listingD, type });
                    });

                    // Update stats incrementally - each card updates as its data arrives
                    setListingStats(prev => {
                        const newMap = new Map(prev);
                        batchStats.forEach((stats, listingD) => {
                            newMap.set(listingD, stats);
                        });
                        return newMap;
                    });

                    // Update spot mapping incrementally
                    setSpotToListingMap(prev => {
                        const newMap = new Map(prev);
                        batchMapping.forEach((mapping, spotId) => {
                            newMap.set(spotId, mapping);
                        });
                        return newMap;
                    });
                }
            } catch (statusError) {
                console.error('[Parlens] Status batch fetching failed (listings still displayed):', statusError);
            }

        } catch (error) {
            console.error('Error fetching listings:', error);
        } finally {
            setIsLoading(false);
            setStatusLoading(false);
        }
    }, [pool, searchCenter]); // Uses capturedLocationRef (ref) - no dependency needed

    // Fetch spots for detailed view - Using a-tag query (linked tree structure)
    const fetchSpots = useCallback(async (listing: ListedParkingMetadata) => {
        if (!pool) return;

        // Clear existing spots explicitly on fresh fetch to avoid duplicates or stale data
        setSpots([]);
        setStatusLoading(true);

        try {
            // Build the parent listing a-tag for linked tree query
            const listingATag = `${KINDS.LISTED_PARKING_METADATA}:${listing.pubkey}:${listing.d}`;

            // Single query using a-tag - all spots linked to this listing
            const spotQueryStart = Date.now();
            const spotEvents = await pool.querySync(DEFAULT_RELAYS, {
                kinds: [KINDS.PARKING_SPOT_LISTING],
                '#a': [listingATag]
            });
            const spotQueryLatency = Date.now() - spotQueryStart;
            DEFAULT_RELAYS.forEach(relay => relayHealthMonitor.recordSuccess(relay, spotQueryLatency));

            // Parse and set spots
            const parsed = parseSpotsFromEvents(spotEvents, listing);
            setSpots(parsed);

            // Fetch statuses for all spots
            if (parsed.length > 0) {
                await fetchStatusesForSpots(parsed);
            }

            console.log(`[Parlens] Spots loaded for ${listing.listing_name}:`, parsed.length);

        } catch (error) {
            DEFAULT_RELAYS.forEach(relay => relayHealthMonitor.recordFailure(relay));
            console.error('Error fetching spots:', error);
        } finally {
            setStatusLoading(false);
        }
    }, [pool]);

    // Helper to parse spot events
    const parseSpotsFromEvents = (events: any[], listing: ListedParkingMetadata): ParkingSpotListing[] => {
        return events.map((event: any) => {
            const getTagValue = (name: string) => event.tags.find((t: string[]) => t[0] === name)?.[1] || '';
            return {
                id: event.id,
                pubkey: event.pubkey,
                d: getTagValue('d'),
                a: getTagValue('a'),
                spot_number: getTagValue('spot_number'),
                floor: getTagValue('floor'),
                short_name: getTagValue('short_name'),
                type: (getTagValue('type') as 'bicycle' | 'motorcycle' | 'car') || 'car',
                location: getTagValue('location'),
                g: getTagValue('g'),
                content: event.content,
                rates: listing.rates?.[getTagValue('type') || 'car']
            };
        });
    };

    // Helper to fetch statuses for specific spots
    const fetchStatusesForSpots = async (spots: ParkingSpotListing[]) => {
        if (!pool || spots.length === 0) return;

        const spotATags = spots.flatMap(s => {
            const clean = `${KINDS.PARKING_SPOT_LISTING}:${s.pubkey}:${s.d}`;
            return [clean, clean + ''];
        });

        const spotStatusStart = Date.now();
        const statusEvents = await pool.querySync(DEFAULT_RELAYS, {
            kinds: [KINDS.LISTED_SPOT_LOG],
            '#a': spotATags,
        });
        const spotStatusLatency = Date.now() - spotStatusStart;
        DEFAULT_RELAYS.forEach(relay => relayHealthMonitor.recordSuccess(relay, spotStatusLatency));

        const latestStatus = new Map<string, any>();
        statusEvents.forEach((ev: any) => {
            const a = ev.tags.find((t: string[]) => t[0] === 'a')?.[1];
            if (!latestStatus.has(a) || latestStatus.get(a).created_at < ev.created_at) {
                latestStatus.set(a, ev);
            }
        });

        const newStatuses = new Map();
        latestStatus.forEach((event, a) => {
            const spot = spots.find(s => `${KINDS.PARKING_SPOT_LISTING}:${s.pubkey}:${s.d}` === a);
            if (spot) {
                const getTagValue = (name: string) => event.tags.find((t: string[]) => t[0] === name)?.[1] || '';
                newStatuses.set(spot.d, {
                    id: event.id,
                    pubkey: event.pubkey,
                    a: getTagValue('a'),
                    status: (getTagValue('status') as 'occupied' | 'open' | 'closed') || 'open',
                    updated_by: getTagValue('updated_by'),
                    authorizer: getTagValue('authorizer'),
                    created_at: event.created_at
                });
            }
        });

        setSpotStatuses((prev) => {
            const merged = new Map(prev);
            newStatuses.forEach((status, dTag) => {
                const existing = merged.get(dTag);
                if (!existing || existing.created_at < status.created_at) {
                    merged.set(dTag, status);
                }
            });
            return merged;
        });
    };

    useEffect(() => {
        // Capture current location on mount (will be updated only on explicit refresh)
        if (currentLocation && !capturedLocationRef.current) {
            capturedLocationRef.current = currentLocation;
        }

        // Fetch ONLY ONCE after location is captured - prevents glitching from live GPS updates
        // Manual refresh button and page re-entry will trigger new fetches
        if (!hasFetchedRef.current && capturedLocationRef.current) {
            hasFetchedRef.current = true;
            fetchListings();
        }
    }, [fetchListings, currentLocation]); // currentLocation in deps to capture it when first available

    // Real-time subscription for listing metadata updates (NEW listings)
    useEffect(() => {
        if (!pool) return;


        const sub = pool.subscribeMany(
            DEFAULT_RELAYS,
            [{
                kinds: [KINDS.LISTED_PARKING_METADATA],
                since: Math.floor(Date.now() / 1000) // Only new events from now
            }] as any,
            {
                onevent(event: any) {
                    // Filter out test events
                    const d = event.tags.find((t: string[]) => t[0] === 'd')?.[1];
                    if (!d || event.content === 'Deleted' || event.content === 'Parlens Relay Check' || d.startsWith('test-relay-check-')) return;


                    // Add or update in listings state
                    setListings(prev => {
                        const key = `${event.pubkey}:${d}`;
                        const existingIndex = prev.findIndex(l => `${l.pubkey}:${l.d}` === key);

                        const getTagValue = (name: string) => event.tags.find((t: string[]) => t[0] === name)?.[1] || '';
                        const getTagValues = (name: string) => event.tags.filter((t: string[]) => t[0] === name).map((t: string[]) => t[1]);

                        const owners = event.tags.filter((t: string[]) => t[0] === 'p' && t[2] === 'admin').map((t: string[]) => t[1]);
                        const managers = event.tags.filter((t: string[]) => t[0] === 'p' && t[2] === 'write').map((t: string[]) => t[1]);
                        const members = event.tags.filter((t: string[]) => t[0] === 'p' && t[2] === 'read').map((t: string[]) => t[1]);
                        const relays = getTagValues('relay');
                        const fp = getTagValue('floor_plan');
                        const floorPlan = fp ? JSON.parse(fp) : undefined;

                        let rates;
                        try {
                            const ratesStr = getTagValue('rates');
                            if (ratesStr) rates = JSON.parse(ratesStr);
                        } catch { }

                        const newListing: ListedParkingMetadata = {
                            id: event.id,
                            pubkey: event.pubkey,
                            d: getTagValue('d'),
                            listing_name: getTagValue('listing_name') || 'Unnamed',
                            location: getTagValue('location'),
                            g: getTagValue('g'),
                            floors: getTagValue('floors'),
                            floor_plan: floorPlan,
                            rates,
                            listing_type: (getTagValue('listing_type') as 'public' | 'private') || 'public',
                            qr_type: (getTagValue('qr_type') as 'static' | 'dynamic') || 'static',
                            status: (getTagValue('status') as 'open' | 'closed') || 'open',
                            owners,
                            managers,
                            members,
                            relays,
                            local_area: getTagValue('local_area'),
                            city: getTagValue('city'),
                            zipcode: getTagValue('zipcode'),
                            created_at: event.created_at,
                            originalEvent: event
                        };

                        if (existingIndex >= 0 && prev[existingIndex]) {
                            // Update existing if newer
                            const existingCreatedAt = prev[existingIndex]?.created_at ?? 0;
                            if (existingCreatedAt < event.created_at) {
                                const updated = [...prev];
                                updated[existingIndex] = newListing;
                                return updated;
                            }
                            return prev;
                        } else {
                            // Add new listing
                            return [newListing, ...prev];
                        }
                    });
                },
                oneose() {
                }
            }
        );

        return () => {
            sub.close();
        };
    }, [pool]);

    // Real-time subscription for Kind 1714 status updates
    useEffect(() => {
        if (!pool) return;

        // Optimizing subscription:
        // 1. If we are viewing a listing (spots are loaded), subscribe to those specific spots.
        // 2. If in list view (spots not loaded), we can't easily subscribe to all spots without fetching them.
        //    For now, we will prioritize the detail view performance as that's where "status" is critical.

        let filterATags: string[] = [];

        if (spots.length > 0) {
            // Detailed view: Subscribe to loaded spots
            filterATags = spots.map(s => `${KINDS.PARKING_SPOT_LISTING}:${s.pubkey}:${s.d}`);
        } else {
            // List view: Optional. Subscribing to ALL listings' spots is heavy.
            // We could fetch listing metadata's "total" but that doesn't give us a-tags.
            // Leaving this blank means List View stats might not be real-time,
            // but avoids the global firehose performance issue.
            // User complaint is about "log status taking time" which implies detail view.
            return;
        }

        if (filterATags.length === 0) return;


        const statusesMapRef: Map<string, { status: string; created_at: number }> = new Map();

        const sub = pool.subscribeMany(
            DEFAULT_RELAYS,
            [{
                kinds: [KINDS.LISTED_SPOT_LOG],
                '#a': filterATags // Efficient filter - no since limit to get all status updates
            }] as any,
            {
                onevent(event: any) {
                    const aTag = event.tags.find((t: string[]) => t[0] === 'a')?.[1];
                    const status = event.tags.find((t: string[]) => t[0] === 'status')?.[1];

                    if (!aTag || !status) return;

                    // Only update if this event is newer than what we have
                    const existing = statusesMapRef.get(aTag);
                    if (existing && existing.created_at >= event.created_at) return;

                    statusesMapRef.set(aTag, { status, created_at: event.created_at });

                    // Update spotStatuses state
                    setSpotStatuses(prev => {
                        const dTag = aTag.split(':').pop(); // Extract d-tag from a-tag
                        if (!dTag) return prev;

                        const newMap = new Map(prev);
                        const existingStatus = newMap.get(dTag);

                        // Only update if newer
                        if (!existingStatus || existingStatus.created_at < event.created_at) {
                            newMap.set(dTag, {
                                id: event.id,
                                pubkey: event.pubkey,
                                a: aTag,
                                status: status as 'occupied' | 'open' | 'closed',
                                updated_by: event.tags.find((t: string[]) => t[0] === 'updated_by')?.[1] || '',
                                authorizer: event.tags.find((t: string[]) => t[0] === 'authorizer')?.[1] || '',
                                created_at: event.created_at
                            });

                            // Global listingStats update using spotToListingMap
                            if (dTag) {
                                const mapping = spotToListingMap.get(dTag);
                                if (mapping) {
                                    setListingStats(prevStats => {
                                        const stats = prevStats.get(mapping.listingId);
                                        if (!stats) return prevStats;

                                        const newStats = new Map(prevStats);
                                        const typeStats = { ...stats[mapping.type] };

                                        // Get old status from newMap to decrement old count
                                        const oldStatus = existingStatus?.status || 'open';
                                        const newStatus = status as 'occupied' | 'open' | 'closed';

                                        // Decrement old status count
                                        if (oldStatus === 'occupied') typeStats.occupied = Math.max(0, typeStats.occupied - 1);
                                        else if (oldStatus === 'closed') typeStats.closed = Math.max(0, typeStats.closed - 1);
                                        else typeStats.open = Math.max(0, typeStats.open - 1);

                                        // Increment new status count
                                        if (newStatus === 'occupied') typeStats.occupied++;
                                        else if (newStatus === 'closed') typeStats.closed++;
                                        else typeStats.open++;

                                        newStats.set(mapping.listingId, { ...stats, [mapping.type]: typeStats });
                                        return newStats;
                                    });
                                }
                            }
                        }
                        return newMap;
                    });
                },
                oneose() {
                    setStatusLoading(false);
                }
            }
        );

        // Timeout fallback for statusLoading (3 seconds)
        const loadingTimeout = setTimeout(() => {
            setStatusLoading(false);
        }, 3000);

        return () => {
            clearTimeout(loadingTimeout);
            sub.close();
        };
    }, [pool, spots, spotToListingMap]); // Added spotToListingMap dependency

    useEffect(() => {
        if (selectedListing) {
            fetchSpots(selectedListing);
        }
    }, [selectedListing, fetchSpots]);

    // Sync listingStats when spotStatuses changes (for real-time updates)
    useEffect(() => {
        if (!selectedListing || spots.length === 0) return;

        // Recalculate stats for the selected listing based on current spotStatuses
        const stats = {
            car: { open: 0, occupied: 0, closed: 0, total: 0, rate: selectedListing.rates?.car?.hourly || 0 },
            motorcycle: { open: 0, occupied: 0, closed: 0, total: 0, rate: selectedListing.rates?.motorcycle?.hourly || 0 },
            bicycle: { open: 0, occupied: 0, closed: 0, total: 0, rate: selectedListing.rates?.bicycle?.hourly || 0 }
        };

        for (const spot of spots) {
            const type = spot.type || 'car';
            const status = spotStatuses.get(spot.d)?.status || 'open';

            if (stats[type]) {
                stats[type].total++;
                if (status === 'occupied') stats[type].occupied++;
                else if (status === 'closed') stats[type].closed++;
                else stats[type].open++;
            }
        }

        setListingStats(prev => {
            const newMap = new Map(prev);
            newMap.set(selectedListing.d, stats);
            return newMap;
        });
    }, [spotStatuses, selectedListing, spots]);

    const deleteListing = async (listing: ListedParkingMetadata) => {
        if (!pool || !pubkey || !signEvent) return;
        if (!confirm(`Delete "${listing.listing_name}" ? This will delete all spots.`)) return;

        setIsDeleting(true);
        try {
            // Delete spots
            const aTag = `${KINDS.LISTED_PARKING_METADATA}:${listing.pubkey}:${listing.d}`;
            const deleteQueryStart = Date.now();
            const spotEvents = await pool.querySync(DEFAULT_RELAYS, { kinds: [KINDS.PARKING_SPOT_LISTING], '#a': [aTag] });
            const deleteQueryLatency = Date.now() - deleteQueryStart;
            DEFAULT_RELAYS.forEach(relay => relayHealthMonitor.recordSuccess(relay, deleteQueryLatency));

            for (const spot of spotEvents) {
                const dTag = spot.tags.find((t: string[]) => t[0] === 'd')?.[1];
                if (dTag) {
                    const deleteSpot = {
                        kind: 5, created_at: Math.floor(Date.now() / 1000),
                        tags: [['e', spot.id], ['a', `${KINDS.PARKING_SPOT_LISTING}:${pubkey}:${dTag}`]],
                        content: 'Deleted'
                    };
                    await Promise.allSettled(pool.publish(DEFAULT_RELAYS, await signEvent(deleteSpot)));
                }
            }

            // Delete listing
            const deleteEvent = {
                kind: 5, created_at: Math.floor(Date.now() / 1000),
                tags: [['e', listing.id], ['a', `${KINDS.LISTED_PARKING_METADATA}:${pubkey}:${listing.d}`]],
                content: 'Deleted'
            };
            await Promise.allSettled(pool.publish(DEFAULT_RELAYS, await signEvent(deleteEvent)));
            setListings(prev => prev.filter(l => l.id !== listing.id));

            setSelectedListing(null);
        } catch (e) { console.error(e); } finally { setIsDeleting(false); }
    };


    const filteredListings = useMemo(() => {
        let res = listings.filter(l => {
            // Saved Filter
            if (showSavedOnly && !savedListings.has(l.id)) return false;

            // Tab filtering
            let match = false;
            if (activeTab === 'public') {
                // Only show public listings that are:
                // 1. Created by the approver (auto-approved), OR
                // 2. Have an approval label from the approver
                const isAutoApproved = l.pubkey === APPROVER_PUBKEY;
                const listingATag = `${KINDS.LISTED_PARKING_METADATA}:${l.pubkey}:${l.d}`;
                const hasApprovalLabel = approvalLabels.has(listingATag);
                match = l.listing_type === 'public' && (isAutoApproved || hasApprovalLabel);
            }
            else if (activeTab === 'private') match = l.listing_type === 'private' && (l.members.includes(pubkey!) || l.owners.includes(pubkey!) || l.managers.includes(pubkey!));
            else if (activeTab === 'my') {
                // For non-approvers: show only their own listings
                const isOwnListing = l.owners.includes(pubkey!) || l.managers.includes(pubkey!);
                const listingATag = `${KINDS.LISTED_PARKING_METADATA}:${l.pubkey}:${l.d}`;
                const isAutoApproved = l.pubkey === APPROVER_PUBKEY;
                const hasApprovalLabel = approvalLabels.has(listingATag);
                const isPending = l.listing_type === 'public' && !isAutoApproved && !hasApprovalLabel;
                const isApprovedListing = l.listing_type === 'public' && (isAutoApproved || hasApprovalLabel);

                if (!isApprover) {
                    match = isOwnListing;

                    // Filter by status if "My Listings" tab is active
                    if (match && activeTab === 'my') {
                        switch (myListingsStatusFilter) {
                            case 'approved':
                                match = isAutoApproved || hasApprovalLabel;
                                break;
                            case 'pending':
                                match = !isAutoApproved && !hasApprovalLabel;
                                break;
                        }
                    }
                } else {
                    // Approver filter logic
                    switch (approverFilter) {
                        case 'my':
                            match = isOwnListing;
                            break;
                        case 'approved':
                            // Show approved findings from OTHERS (exclude own listings as they are auto-approved/don't need review)
                            match = !isOwnListing && isApprovedListing;
                            break;
                        case 'pending':
                            // Show pending findings from OTHERS force-filter
                            match = isPending;
                            break;
                        case 'all':
                        default:
                            // Show own listings + all public listings (approved and pending)
                            match = isOwnListing || l.listing_type === 'public';
                            break;
                    }
                }
            }

            if (!match) return false;

            // Filter hidden/blocked
            // Standard users: only filter in Public/Private tabs (never My Listings)
            // Approvers: also filter in My Listings (to allow decluttering)
            if (activeTab !== 'my' || isApprover) {
                if (isHidden(l.id, l.pubkey)) return false;
            }

            // Search filtering with match scoring for sorting
            if (confirmedSearchTerm) {
                const term = confirmedSearchTerm.toLowerCase();
                const textMatch = l.listing_name.toLowerCase().includes(term) ||
                    l.local_area?.toLowerCase().includes(term) ||
                    l.city?.toLowerCase().includes(term) ||
                    l.zipcode?.toLowerCase().includes(term);
                if (!textMatch) return false;
            }
            return true;
        });

        // Sorting Logic
        // 1. Search match priority (exact name match first)
        // 2. Distance (if location + user location available)
        // 3. Open Spots (desc)
        res.sort((a, b) => {
            // Search match priority: exact name match > partial match
            if (confirmedSearchTerm) {
                const term = confirmedSearchTerm.toLowerCase();
                const exactMatchA = a.listing_name.toLowerCase() === term;
                const exactMatchB = b.listing_name.toLowerCase() === term;
                if (exactMatchA && !exactMatchB) return -1;
                if (!exactMatchA && exactMatchB) return 1;
            }

            // Distance (if searchCenter or location available)
            const center = searchCenter || currentLocation;
            if (center && a.location && b.location) {
                const [latA, lonA] = a.location.split(',').map(n => parseFloat(n.trim()));
                const [latB, lonB] = b.location.split(',').map(n => parseFloat(n.trim()));

                if (!isNaN(latA) && !isNaN(lonA) && !isNaN(latB) && !isNaN(lonB)) {
                    const distA = calculateDistance(center[0], center[1], latA, lonA);
                    const distB = calculateDistance(center[0], center[1], latB, lonB);
                    if (Math.abs(distA - distB) > 0.1) return distA - distB; // Sort by dist if diff > 100m
                }
            }

            // Open Spots (for selected filter or total)
            const statsA = listingStats.get(a.d);
            const statsB = listingStats.get(b.d);

            const getOpen = (stats: any) => {
                if (!stats) return 0;
                if (vehicleFilter === 'all') return (stats.car.open + stats.motorcycle.open + stats.bicycle.open);
                return stats[vehicleFilter]?.open || 0;
            };

            const openA = getOpen(statsA);
            const openB = getOpen(statsB);

            if (openA !== openB) return openB - openA; // More open spots first

            // Name fallback
            return a.listing_name.localeCompare(b.listing_name);
        });

        return res;
    }, [listings, activeTab, pubkey, searchTerm, listingStats, vehicleFilter, currentLocation, savedListings, showSavedOnly, confirmedSearchTerm, searchCenter, approverFilter, isApprover, approvalLabels, hiddenItems]);

    // Paginated listings for display (limited to displayedCount)
    const paginatedListings = useMemo(() => {
        return filteredListings.slice(0, displayedCount);
    }, [filteredListings, displayedCount]);

    // Get unique floors for filter dropdown
    const uniqueFloors = useMemo(() => {
        const floors = new Set<string>();
        spots.forEach(s => {
            if (s.floor) floors.add(s.floor);
        });
        return Array.from(floors).sort();
    }, [spots]);

    // Enhanced filtered spots with floor and status filters
    // Non-owners only see open spots
    const filteredSpots = useMemo(() => {
        const isOwnerOrManager = selectedListing && pubkey && (
            selectedListing.owners.includes(pubkey) || selectedListing.managers.includes(pubkey)
        );

        return spots.filter(s => {
            if (vehicleFilter !== 'all' && s.type !== vehicleFilter) return false;
            if (floorFilter !== 'all' && s.floor !== floorFilter) return false;

            const status = spotStatuses.get(s.d);
            const spotStatus = status?.status || 'open';

            // Non-owners in public/private tabs only see open spots
            if (!isOwnerOrManager && spotStatus !== 'open') return false;

            if (statusFilter !== 'all') {
                if (spotStatus !== statusFilter) return false;
            }
            return true;
        }).sort((a, b) => parseInt(a.spot_number || '0') - parseInt(b.spot_number || '0'));
    }, [spots, vehicleFilter, floorFilter, statusFilter, spotStatuses, selectedListing, pubkey]);

    return (
        <div className="fixed inset-0 z-[3000] bg-zinc-50 dark:bg-black flex flex-col transition-colors">
            {/* Loading Overlay for Deleting */}
            {isTogglingStatus && (
                <div className="fixed inset-0 z-[6000] flex items-center justify-center bg-black/60 backdrop-blur-sm flex-col animate-in fade-in duration-200">
                    <div className="animate-spin w-10 h-10 border-4 border-white/20 border-t-white rounded-full"></div>
                    <div className="text-white font-bold mt-4 animate-pulse">Updating Status...</div>
                </div>
            )}

            {isDeleting && (
                <div className="fixed inset-0 z-[3100] flex items-center justify-center bg-black/50 backdrop-blur-sm flex-col">
                    <div className="animate-spin w-8 h-8 border-4 border-white/20 border-t-white rounded-full"></div>
                    <div className="text-white font-bold mt-4">Deleting...</div>
                </div>
            )}

            {/* Header */}
            <div className="bg-white dark:bg-[#1c1c1e] border-b border-black/5 dark:border-white/10">
                {/* Top Row - Title and Action Buttons */}
                <div className="flex items-center justify-between px-4 py-3">
                    <div className="flex items-center gap-3">
                        <button onClick={selectedListing ? () => setSelectedListing(null) : onClose} className="p-2 rounded-full bg-black/5 dark:bg-white/10 active:scale-95 transition-transform" style={{ WebkitTapHighlightColor: 'transparent' }}>
                            <ChevronRight size={20} className="text-black/60 dark:text-white/60 rotate-180" />
                        </button>
                        <h1 className="text-xl font-bold bg-gradient-to-r from-blue-500 to-cyan-500 bg-clip-text text-transparent">
                            {selectedListing ? selectedListing.listing_name : 'Listed Parking'}
                        </h1>
                    </div>
                    <div className="flex items-center gap-2">
                        {!selectedListing && (
                            <button
                                onClick={() => setShowCreateForm(true)}
                                className="p-2 bg-gradient-to-r from-blue-500 to-cyan-500 text-white rounded-full shadow-lg shadow-blue-500/20 active:scale-95 transition-transform"
                                style={{ WebkitTapHighlightColor: 'transparent' }}
                            >
                                <Plus size={20} />
                            </button>
                        )}
                        <button
                            onClick={async () => {
                                if (statusLoading) return; // Debounce
                                setStatusLoading(true);

                                // Yield to UI to paint spinner
                                setTimeout(async () => {
                                    // Update captured location on explicit refresh
                                    if (currentLocation) {
                                        capturedLocationRef.current = currentLocation;
                                    }

                                    // Parallelize fetches:
                                    // 1. fetchListings(true) -> Silent mode, updates list/metadata but doesn't touch loading states
                                    // 2. fetchSpots -> Updates detail view spots
                                    const promises = [fetchListings(true)];
                                    if (selectedListing) {
                                        promises.push(fetchSpots(selectedListing));
                                    }

                                    await Promise.all(promises);
                                }, 50);
                            }}
                            className={`p-2 bg-gradient-to-r from-blue-500 to-cyan-500 text-white rounded-full shadow-lg shadow-blue-500/20 active:scale-95 transition-transform ${statusLoading ? 'opacity-70 cursor-not-allowed' : ''}`}
                            style={{ WebkitTapHighlightColor: 'transparent' }}
                            title="Refresh"
                        >
                            <RotateCw size={20} className={statusLoading ? 'animate-spin' : ''} />
                        </button>
                    </div>
                </div>
            </div>

            {/* Content Container */}
            <div className="flex-1 flex flex-col overflow-hidden">
                {selectedListing ? (
                    // Spot View
                    // Spot View
                    <div className="flex-1 flex flex-col p-4 bg-zinc-50 dark:bg-black/50 min-h-0">
                        {/* Dropdown Filters - Flex for responsive single row */}
                        <div className="flex gap-2 mb-4 shrink-0">
                            {/* Vehicle Type Filter */}
                            <select
                                value={vehicleFilter}
                                onChange={e => setVehicleFilter(e.target.value as any)}
                                style={{ WebkitTapHighlightColor: 'transparent' }}
                                className="flex-1 min-w-0 px-2 py-2 bg-white dark:bg-zinc-800 border border-black/10 dark:border-white/20 rounded-xl text-[11px] font-medium text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 appearance-none bg-[url('data:image/svg+xml;charset=UTF-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2212%22%20height%3D%2212%22%20viewBox%3D%220%200%2012%2012%22%3E%3Cpath%20fill%3D%22%23888%22%20d%3D%22M2%204l4%204%204-4z%22%2F%3E%3C%2Fsvg%3E')] bg-no-repeat bg-[right_0.5rem_center] pr-6 truncate"
                            >
                                <option value="all">All Types</option>
                                <option value="car">🚗 Car</option>
                                <option value="motorcycle">🏍️ Motorcycle</option>
                                <option value="bicycle">🚲 Bicycle</option>
                            </select>

                            {/* Floor Filter */}
                            <select
                                value={floorFilter}
                                onChange={e => setFloorFilter(e.target.value)}
                                style={{ WebkitTapHighlightColor: 'transparent' }}
                                className="flex-1 min-w-0 px-2 py-2 bg-white dark:bg-zinc-800 border border-black/10 dark:border-white/20 rounded-xl text-[11px] font-medium text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 appearance-none bg-[url('data:image/svg+xml;charset=UTF-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2212%22%20height%3D%2212%22%20viewBox%3D%220%200%2012%2012%22%3E%3Cpath%20fill%3D%22%23888%22%20d%3D%22M2%204l4%204%204-4z%22%2F%3E%3C%2Fsvg%3E')] bg-no-repeat bg-[right_0.5rem_center] pr-6 truncate"
                            >
                                <option value="all">All Floors</option>
                                {uniqueFloors.map(floor => (
                                    <option key={floor} value={floor}>{floor}</option>
                                ))}
                            </select>

                            {/* Status Filter */}
                            <select
                                value={statusFilter}
                                onChange={e => setStatusFilter(e.target.value as any)}
                                style={{ WebkitTapHighlightColor: 'transparent' }}
                                className="flex-1 min-w-0 px-2 py-2 bg-white dark:bg-zinc-800 border border-black/10 dark:border-white/20 rounded-xl text-[11px] font-medium text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 appearance-none bg-[url('data:image/svg+xml;charset=UTF-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2212%22%20height%3D%2212%22%20viewBox%3D%220%200%2012%2012%22%3E%3Cpath%20fill%3D%22%23888%22%20d%3D%22M2%204l4%204%204-4z%22%2F%3E%3C%2Fsvg%3E')] bg-no-repeat bg-[right_0.5rem_center] pr-6 truncate"
                            >
                                <option value="all">All Status</option>
                                <option value="open">🟢 Open</option>
                                <option value="occupied">🔴 Occupied</option>
                                <option value="closed">⚪ Closed</option>
                            </select>
                        </div>

                        <div className="flex-1 overflow-y-auto min-h-0">
                            {/* List of Spots - Progressive Loading */}
                            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                                {filteredSpots.map(spot => {
                                    const status = spotStatuses.get(spot.d);
                                    const statusColor = status?.status === 'occupied' ? 'bg-red-500/10 border-red-500/20 text-red-600 dark:text-red-400' :
                                        status?.status === 'closed' ? 'bg-zinc-500/10 border-zinc-500/20 text-zinc-600 dark:text-zinc-400' :
                                            'bg-green-500/10 border-green-500/20 text-green-600 dark:text-green-400';
                                    return (
                                        <button
                                            key={spot.id}
                                            onClick={() => setSelectedSpot(spot)}
                                            className={`p-3 rounded-2xl border ${statusColor} text-center active:scale-[0.98] transition-transform relative`}
                                        >
                                            <div className="text-3xl mb-1">
                                                {spot.type === 'car' ? '🚗' : spot.type === 'motorcycle' ? '🏍️' : '🚲'}
                                            </div>
                                            <p className="font-bold text-sm text-zinc-900 dark:text-white">
                                                {spot.short_name || `#${spot.spot_number}`}
                                            </p>
                                            {spot.floor && <p className="text-xs opacity-60">{spot.floor}</p>}
                                            <p className="mt-1 text-[10px] font-bold uppercase tracking-wider opacity-80">{status?.status || 'Open'}</p>
                                        </button>
                                    );
                                })}

                                {/* Bottom Spinner - Shows when more spots are loading */}
                                {statusLoading && (
                                    <div className="flex items-center justify-center p-6 bg-zinc-50 dark:bg-white/5 rounded-2xl border-2 border-dashed border-zinc-200 dark:border-white/10 min-h-[100px]">
                                        <div className="animate-spin w-8 h-8 rounded-full border-4 border-blue-500/20 border-t-blue-500"></div>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                ) : (
                    // List View
                    <>
                        <div className="px-4 py-2 bg-white dark:bg-[#1c1c1e] border-t border-black/5 dark:border-white/10">
                            <div className="flex justify-between items-center gap-2">
                                {(['public', 'private', 'my'] as TabType[]).map(tab => (
                                    <button
                                        key={tab}
                                        onClick={() => setActiveTab(tab)}
                                        className={`flex-1 flex items-center justify-center py-2 text-sm transition-all active:scale-95 ${activeTab === tab
                                            ? 'text-zinc-900 dark:text-white font-bold border-b-2 border-blue-500'
                                            : 'text-zinc-400 dark:text-white/40'
                                            }`}
                                    >
                                        {tab === 'public' ? 'Public' : tab === 'private' ? 'Private' : 'My Listings'}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Search Bar with Suggestions */}
                        <div className="relative px-4 py-3 bg-white dark:bg-[#1c1c1e] border-b border-black/5 dark:border-white/10 z-[3001]">
                            <div className="relative z-[4000]">
                                {/* Search Icon Inside Input Container to fix gap and z-index */}
                                <div className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 z-10">
                                    {isSuggesting ? (
                                        <RotateCw size={18} className="animate-spin" />
                                    ) : (
                                        <Search size={18} />
                                    )}
                                </div>

                                <input
                                    value={searchTerm}
                                    onChange={handleInputChange}
                                    onKeyDown={e => { if (e.key === 'Enter') handleSearch(); }}
                                    placeholder="Search for listings near..."
                                    className={`w-full pl-10 pr-10 py-3 bg-zinc-100 dark:bg-zinc-800 text-sm font-medium text-zinc-900 dark:text-white border-none focus:ring-2 focus:ring-blue-500/50 transition-all placeholder:text-zinc-400 dark:placeholder:text-zinc-500 ${(suggestions.length > 0 || savedMatches.length > 0 || listingMatches.length > 0)
                                        ? 'rounded-t-xl rounded-b-none'
                                        : 'rounded-xl'
                                        }`}
                                />

                                {searchTerm && (
                                    <button
                                        onClick={() => {
                                            setSearchTerm('');
                                            setSuggestions([]);
                                            setConfirmedSearchTerm('');
                                            if (currentLocation) setSearchCenter(currentLocation);
                                        }}
                                        className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded-full text-zinc-400 active:text-zinc-600 dark:active:text-zinc-200 z-10"
                                    >
                                        <X size={16} />
                                    </button>
                                )}

                                {/* Suggestions Dropdown */}
                                {(suggestions.length > 0 || savedMatches.length > 0 || listingMatches.length > 0) && (
                                    <div className="absolute top-full left-0 right-0 bg-white dark:bg-zinc-900 rounded-b-xl shadow-xl border-x border-b border-black/5 dark:border-white/5 overflow-hidden z-[4000] mt-0">
                                        <div className="max-h-[60vh] overflow-y-auto">
                                            {/* Tags Header */}
                                            <div className="px-4 py-2 bg-zinc-50 dark:bg-white/5 border-t border-black/5 dark:border-white/5 flex items-center gap-2">
                                                {listingMatches.length > 0 && (
                                                    <span className="inline-block px-2.5 py-1 rounded-lg bg-gradient-to-r from-blue-500/10 to-cyan-500/10 dark:from-blue-500/20 dark:to-cyan-500/20 text-[10px] font-bold text-blue-600 dark:text-blue-300 uppercase tracking-wider border border-blue-200 dark:border-blue-500/20">
                                                        Locality
                                                    </span>
                                                )}
                                                {suggestions.length > 0 && (
                                                    <span className="inline-block px-2.5 py-1 rounded-lg bg-gradient-to-r from-violet-500/10 to-fuchsia-500/10 dark:from-violet-500/20 dark:to-fuchsia-500/20 text-[10px] font-bold text-violet-600 dark:text-violet-300 uppercase tracking-wider border border-violet-200 dark:border-violet-500/20">
                                                        OSM Search
                                                    </span>
                                                )}
                                                {savedMatches.length > 0 && (
                                                    <span className="inline-block px-2.5 py-1 rounded-lg bg-gradient-to-r from-emerald-500/10 to-teal-500/10 dark:from-emerald-500/20 dark:to-teal-500/20 text-[10px] font-bold text-emerald-600 dark:text-emerald-300 uppercase tracking-wider border border-emerald-200 dark:border-emerald-500/20">
                                                        Saved Places
                                                    </span>
                                                )}
                                            </div>

                                            {/* Listing Matches (Blue) */}
                                            {listingMatches.map((match, index) => (
                                                <button
                                                    key={`listing-${index}`}
                                                    onClick={() => {
                                                        const suggestion: NominatimResult = {
                                                            place_id: parseInt(match.lat.toString().replace('.', '')),
                                                            display_name: match.name,
                                                            lat: match.lat.toString(),
                                                            lon: match.lon.toString(),
                                                            type: 'listing'
                                                        };
                                                        handleSelectSuggestion(suggestion);
                                                    }}
                                                    className="w-full flex items-start gap-3 p-4 text-left hover:bg-zinc-50 dark:hover:bg-white/5 active:bg-zinc-100 transition-colors border-t border-black/5 dark:border-white/5 first:border-t-0 group"
                                                >
                                                    <div className="mt-0.5 p-2 rounded-full bg-blue-50 dark:bg-blue-500/10 text-blue-500 group-hover:text-blue-600 dark:group-hover:text-blue-400 shrink-0 transition-colors">
                                                        <MapPin size={16} />
                                                    </div>
                                                    <div className="flex-1 min-w-0">
                                                        <div className="text-sm font-semibold text-zinc-900 dark:text-white truncate">
                                                            {match.name}
                                                        </div>
                                                        <div className="text-xs text-zinc-500 dark:text-zinc-400 truncate">
                                                            Parking listings nearby
                                                        </div>
                                                    </div>
                                                </button>
                                            ))}

                                            {/* Saved Matches */}
                                            {savedMatches.map((match, index) => (
                                                <button
                                                    key={`saved-${index}`}
                                                    onClick={() => {
                                                        const suggestion: NominatimResult = {
                                                            place_id: parseInt(match.lat.toString().replace('.', '')),
                                                            display_name: match.name,
                                                            lat: match.lat.toString(),
                                                            lon: match.lon.toString(),
                                                            type: 'saved'
                                                        };
                                                        handleSelectSuggestion(suggestion);
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
                                                        <div className="text-xs text-zinc-500 dark:text-zinc-400 truncate">
                                                            Saved from your routes
                                                        </div>
                                                    </div>
                                                </button>
                                            ))}

                                            {/* Online Matches (Purple) */}
                                            {suggestions.map((item) => (
                                                <button
                                                    key={item.place_id}
                                                    onClick={() => handleSelectSuggestion(item)}
                                                    className="w-full flex items-start gap-3 p-4 text-left hover:bg-zinc-50 dark:hover:bg-white/5 active:bg-zinc-100 transition-colors border-t border-black/5 dark:border-white/5 group"
                                                >
                                                    <div className="mt-0.5 p-2 rounded-full shrink-0 transition-colors bg-violet-50 dark:bg-violet-500/10 text-violet-500 group-hover:text-violet-600 dark:group-hover:text-violet-400">
                                                        <MapPin size={16} />
                                                    </div>
                                                    <div className="flex-1 min-w-0">
                                                        <div className="text-sm font-semibold text-zinc-900 dark:text-white truncate">
                                                            {item.display_name.split(',')[0]}
                                                        </div>
                                                        <div className="text-xs text-zinc-500 dark:text-zinc-400 truncate">
                                                            {item.display_name.split(',').slice(1).join(',')}
                                                        </div>
                                                    </div>
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Status Legend & Saved Listings Toggle */}
                        <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-zinc-500 px-4 py-2 overflow-x-auto shrink-0">
                            <div className="flex items-center gap-3">
                                <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-green-500"></div>Open</div>
                                {activeTab === 'my' && (
                                    <>
                                        <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-red-500"></div>Occupied</div>
                                        <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-zinc-400"></div>Closed</div>
                                    </>
                                )}
                            </div>
                            {/* Approver: Dropdown filter for listings view */}
                            {isApprover && activeTab === 'my' && (
                                <select
                                    value={approverFilter}
                                    onChange={(e) => setApproverFilter(e.target.value as 'all' | 'my' | 'approved' | 'pending')}
                                    className="pl-2 pr-6 py-1 rounded-full border border-transparent bg-zinc-100 dark:bg-white/5 text-zinc-500 dark:text-zinc-400 text-[10px] font-bold uppercase tracking-wider appearance-none cursor-pointer transition-colors active:bg-zinc-200 dark:active:bg-white/10 outline-none"
                                    style={{
                                        backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%239ca3af'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M19 9l-7 7-7-7'%3E%3C/path%3E%3C/svg%3E")`,
                                        backgroundRepeat: 'no-repeat',
                                        backgroundPosition: 'right 6px center',
                                        backgroundSize: '12px'
                                    }}
                                >
                                    <option value="all">All</option>
                                    <option value="my">Mine</option>
                                    <option value="approved">Approved</option>
                                    <option value="pending">Pending</option>
                                </select>
                            )}

                            {/* User: Dropdown filter for My Listings status */}
                            {!isApprover && activeTab === 'my' && (
                                <select
                                    value={myListingsStatusFilter}
                                    onChange={(e) => setMyListingsStatusFilter(e.target.value as 'all' | 'approved' | 'pending')}
                                    className="pl-2 pr-6 py-1 rounded-full border border-transparent bg-zinc-100 dark:bg-white/5 text-zinc-500 dark:text-zinc-400 text-[10px] font-bold uppercase tracking-wider appearance-none cursor-pointer transition-colors active:bg-zinc-200 dark:active:bg-white/10 outline-none"
                                    style={{
                                        backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%239ca3af'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M19 9l-7 7-7-7'%3E%3C/path%3E%3C/svg%3E")`,
                                        backgroundRepeat: 'no-repeat',
                                        backgroundPosition: 'right 6px center',
                                        backgroundSize: '12px'
                                    }}
                                >
                                    <option value="all">All</option>
                                    <option value="approved">Approved</option>
                                    <option value="pending">Pending</option>
                                </select>
                            )}

                            {/* Saved Filter - Only show on public/private tabs, not my listings */}
                            {activeTab !== 'my' && (
                                <button
                                    onClick={() => setShowSavedOnly(!showSavedOnly)}
                                    className={`flex items-center gap-1 px-2 py-1 rounded-full border transition-colors text-[10px] font-bold uppercase tracking-wider ${showSavedOnly
                                        ? 'bg-yellow-500/10 border-yellow-500/20 text-yellow-600 dark:text-yellow-400'
                                        : 'bg-zinc-100 dark:bg-white/5 border-transparent text-zinc-500 active:bg-zinc-200 dark:active:bg-white/10'
                                        }`}
                                >
                                    <Star size={12} className={showSavedOnly ? 'fill-yellow-500 stroke-yellow-500' : 'fill-transparent stroke-zinc-400'} />
                                    {showSavedOnly ? 'Saved' : 'All'}
                                </button>
                            )}
                        </div>

                        <div className="flex-1 overflow-y-auto pt-2 px-4 pb-4 space-y-3">
                            {isLoading ? (
                                <div className="flex justify-center p-8"><div className="w-8 h-8 rounded-full border-4 border-blue-500/20 border-t-blue-500 animate-spin" /></div>
                            ) : filteredListings.length === 0 ? (
                                <div className="text-center py-10 text-zinc-400">No listings found</div>
                            ) : (
                                <>
                                    {paginatedListings.map(listing => {
                                        const stats = listingStats.get(listing.d);

                                        // Ground-Up Status Derivation:
                                        // If stats exist, determine "Closed" state based on actual spots.
                                        // Listing is CLOSED if there are spots but NONE are open or occupied (i.e. all closed).
                                        let isClosed = listing.status === 'closed';

                                        if (stats) {
                                            const totalOpen = (stats.car?.open || 0) + (stats.motorcycle?.open || 0) + (stats.bicycle?.open || 0);
                                            const totalOccupied = (stats.car?.occupied || 0) + (stats.motorcycle?.occupied || 0) + (stats.bicycle?.occupied || 0);
                                            const totalSpots = (stats.car?.total || 0) + (stats.motorcycle?.total || 0) + (stats.bicycle?.total || 0);

                                            if (totalSpots > 0) {
                                                isClosed = (totalOpen + totalOccupied) === 0;
                                            }
                                        }

                                        // Use Ground-Up Stats directly
                                        const displayStats = stats;

                                        return (
                                            <div key={listing.id} className={`group relative bg-white dark:bg-[#1c1c1e] rounded-2xl p-2.5 border border-black/5 dark:border-white/10 shadow-sm transition-all hover:shadow-md active:scale-[0.99] cursor-pointer ${showHideMenu === listing.id ? 'z-50' : ''}`} onClick={() => setSelectedListing(listing)}>
                                                <div className="flex flex-col items-start gap-1 mb-2">
                                                    <div className="flex items-center justify-between w-full gap-1.5">
                                                        <div className="min-w-0 flex items-center h-full">
                                                            <h3 className="font-bold text-zinc-900 dark:text-white text-base leading-tight truncate">{listing.listing_name}</h3>
                                                        </div>

                                                        {/* Access List Button */}
                                                        <div className="flex items-center gap-1 h-full">
                                                            {/* Save Button - Only on public/private tabs */}
                                                            {activeTab !== 'my' && (
                                                                <button
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        toggleSaved(listing.id);
                                                                    }}
                                                                    className="p-2 rounded-full active:scale-95 transition-transform flex items-center justify-center"
                                                                    style={{ WebkitTapHighlightColor: 'transparent' }}
                                                                >
                                                                    <Star size={16} className={savedListings.has(listing.id) ? 'fill-yellow-500 stroke-yellow-500 text-yellow-500' : 'text-zinc-400'} />
                                                                </button>
                                                            )}
                                                            <button
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    setShowAccessListModal(listing);
                                                                }}
                                                                style={{ WebkitTapHighlightColor: 'transparent' }}
                                                                className="p-1.5 text-zinc-400 flex items-center justify-center"
                                                            >
                                                                <Users size={16} />
                                                            </button>
                                                            {activeTab === 'my' && listing.owners.includes(pubkey!) ? (
                                                                <>
                                                                    <button onClick={(e) => { e.stopPropagation(); setEditingListing(listing); setShowCreateForm(true); }} style={{ WebkitTapHighlightColor: 'transparent' }} className="p-1.5 text-zinc-400 flex items-center justify-center">
                                                                        <Pencil size={16} />
                                                                    </button>
                                                                    <button onClick={(e) => { e.stopPropagation(); deleteListing(listing); }} style={{ WebkitTapHighlightColor: 'transparent' }} className="p-1.5 text-zinc-400 flex items-center justify-center">
                                                                        <Trash2 size={16} />
                                                                    </button>
                                                                </>
                                                            ) : activeTab === 'my' && listing.managers.includes(pubkey!) ? (
                                                                // Managers get no list-level actions (only spot grid updates)
                                                                null
                                                            ) : (
                                                                <div className="relative flex items-center">
                                                                    <button
                                                                        onClick={(e) => { e.stopPropagation(); setShowHideMenu(showHideMenu === listing.id ? null : listing.id); }}
                                                                        style={{ WebkitTapHighlightColor: 'transparent' }}
                                                                        className="p-1.5 text-zinc-400 flex items-center justify-center"
                                                                    >
                                                                        <MoreVertical size={16} />
                                                                    </button>
                                                                    {showHideMenu === listing.id && (
                                                                        <>
                                                                            <style>{`
                                                                            @keyframes menuFadeIn {
                                                                                from { opacity: 0; transform: scale(0.95); }
                                                                                to { opacity: 1; transform: scale(1); }
                                                                            }
                                                                        `}</style>
                                                                            <div
                                                                                className="absolute right-0 top-8 bg-white dark:bg-zinc-800 border border-black/10 dark:border-white/20 rounded-xl shadow-xl z-50 overflow-hidden min-w-[200px]"
                                                                                style={{ animation: 'menuFadeIn 0.2s cubic-bezier(0.16, 1, 0.3, 1) forwards', transformOrigin: 'top right' }}
                                                                                onClick={(e) => e.stopPropagation()}
                                                                            >
                                                                                <button
                                                                                    onClick={(e) => { e.stopPropagation(); hideListing(listing.id, listing.listing_name); }}
                                                                                    className="w-full px-4 py-3 text-left text-sm text-zinc-700 dark:text-white hover:bg-zinc-100 dark:hover:bg-zinc-700 flex items-center gap-2"
                                                                                >
                                                                                    <EyeOff size={16} /> Hide this listing
                                                                                </button>
                                                                                {listing.pubkey && (
                                                                                    <button
                                                                                        onClick={(e) => { e.stopPropagation(); hideOwner(listing.pubkey!, listing.listing_name + ' (owner)'); }}
                                                                                        className="w-full px-4 py-3 text-left text-sm text-zinc-700 dark:text-white hover:bg-zinc-100 dark:hover:bg-zinc-700 flex items-center gap-2 border-t border-black/5 dark:border-white/10"
                                                                                    >
                                                                                        <Ban size={16} /> Hide all from owner
                                                                                    </button>
                                                                                )}
                                                                            </div>
                                                                        </>
                                                                    )}
                                                                </div>
                                                            )}
                                                        </div>
                                                    </div>



                                                    {/* Tags - moved below location */}
                                                    <div className="flex items-center gap-2 flex-wrap">
                                                        <span className={`shrink-0 px-2 py-0.5 rounded-full text-[9px] uppercase tracking-wider ${listing.listing_type === 'public' ? 'bg-green-500/10 text-green-600' : 'bg-purple-500/10 text-purple-600'}`}>
                                                            {listing.listing_type}
                                                        </span>
                                                        {isClosed && (
                                                            <span className="shrink-0 px-2 py-0.5 rounded-full text-[9px] uppercase tracking-wider bg-zinc-500/10 text-zinc-500 dark:text-zinc-400">
                                                                CLOSED
                                                            </span>
                                                        )}
                                                        {(listing.local_area || listing.city) && (
                                                            <span className="shrink-0 px-2 py-0.5 rounded-full text-[9px] uppercase tracking-wider bg-blue-500/10 text-blue-500">
                                                                {listing.local_area || listing.city}
                                                            </span>
                                                        )}
                                                    </div>
                                                </div>

                                                <div className="grid grid-cols-3 gap-2">
                                                    {[
                                                        { type: 'car' as const, icon: '🚗', data: displayStats?.car, rate: listing.rates?.car },
                                                        { type: 'motorcycle' as const, icon: '🏍️', data: displayStats?.motorcycle, rate: listing.rates?.motorcycle },
                                                        { type: 'bicycle' as const, icon: '🚲', data: displayStats?.bicycle, rate: listing.rates?.bicycle }
                                                    ].map(v => {
                                                        // Availability based strictly on capacity (spots > 0)
                                                        // This ensures consistent "Not Available" state across Public and Private
                                                        const isAvailable = (v.data?.total || 0) > 0;

                                                        // Rate display logic:
                                                        // - Always show if rate exists
                                                        // - If Available (has spots) but no rate, default to 0/hr
                                                        const displayRate = v.rate || { hourly: 0, currency: 'INR' };
                                                        const showRate = !!v.rate || isAvailable;

                                                        return (
                                                            <div key={v.type} className={`bg-zinc-50 dark:bg-white/10 rounded-xl p-2 text-center flex flex-col items-center justify-center min-h-[80px] ${isClosed ? 'opacity-50' : ''}`}>
                                                                <div className="text-3xl mb-1">{v.icon}</div>
                                                                {statusLoading ? (
                                                                    <div className="text-xl font-bold text-zinc-300 dark:text-white/20">...</div>
                                                                ) : isAvailable ? (
                                                                    <div className="flex flex-col items-center w-full">
                                                                        {activeTab === 'my' ? (
                                                                            // My Listings: Show full breakdown (Open|Occupied|Closed)
                                                                            <div className="font-bold text-sm flex items-center gap-1.5 mb-1.5">
                                                                                <span className="text-green-500">{v.data?.open || 0}</span>
                                                                                <span className="text-zinc-300 dark:text-white/20">|</span>
                                                                                <span className="text-red-500">{v.data?.occupied || 0}</span>
                                                                                <span className="text-zinc-300 dark:text-white/20">|</span>
                                                                                <span className="text-zinc-400">{v.data?.closed || 0}</span>
                                                                            </div>
                                                                        ) : (
                                                                            // Public/Private: Show only Open count
                                                                            <div className="font-bold text-lg text-green-500 mb-1.5">{v.data?.open || 0}</div>
                                                                        )}
                                                                        {showRate && (
                                                                            <div className="w-full bg-black/5 dark:bg-white/5 rounded-lg py-0.5 px-2">
                                                                                <div className="text-zinc-900 dark:text-white font-bold text-sm">
                                                                                    {displayRate.currency === 'USD' ? '$' : displayRate.currency === 'EUR' ? '€' : displayRate.currency === 'GBP' ? '£' : '₹'}{displayRate.hourly}<span className="text-[10px] font-normal opacity-60">/hr</span>
                                                                                </div>
                                                                            </div>
                                                                        )}
                                                                    </div>
                                                                ) : (
                                                                    <div className="text-xs text-zinc-400 dark:text-white/30 font-medium">Not Available</div>
                                                                )}
                                                            </div>
                                                        );
                                                    })}
                                                </div>

                                                {/* Approver: Approval Toggle - Only in My Listings (Approver Dashboard) */}
                                                {isApprover && activeTab === 'my' && listing.listing_type === 'public' && listing.pubkey !== APPROVER_PUBKEY && (() => {
                                                    const listingATag = `${KINDS.LISTED_PARKING_METADATA}:${listing.pubkey}:${listing.d}`;
                                                    const isListingApproved = approvalLabels.has(listingATag);
                                                    return (
                                                        <div className="mt-3 pt-3 border-t border-black/5 dark:border-white/5 flex items-center justify-between" onClick={(e) => e.stopPropagation()}>
                                                            <span className={`text-sm font-semibold ${isListingApproved ? 'text-blue-600 dark:text-blue-400' : 'text-zinc-500 dark:text-white/50'}`}>
                                                                {isListingApproved ? 'Approved' : 'Pending Approval'}
                                                            </span>
                                                            <button
                                                                onClick={() => toggleListingApproval(listing)}
                                                                disabled={isApprovingListing}
                                                                className={`relative h-7 w-12 rounded-full transition-colors ${isListingApproved ? 'bg-blue-500' : 'bg-zinc-200 dark:bg-white/10'} ${isApprovingListing ? 'opacity-50 cursor-wait' : ''}`}
                                                                style={{ WebkitTapHighlightColor: 'transparent' }}
                                                            >
                                                                <span className={`block h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${isListingApproved ? 'translate-x-[26px]' : 'translate-x-[4px]'}`} />
                                                            </button>
                                                        </div>
                                                    );
                                                })()}

                                                {/* Close All Toggle */}
                                                {
                                                    activeTab === 'my' && (listing.owners.includes(pubkey!) || listing.managers.includes(pubkey!)) && (
                                                        <div className="mt-3 pt-3 border-t border-black/5 dark:border-white/5 flex items-center justify-between relative" onClick={(e) => e.stopPropagation()}>
                                                            <span className={`text-sm font-semibold ${!isClosed ? 'text-green-600 dark:text-green-400' : 'text-zinc-500 dark:text-white/50'}`}>
                                                                {!isClosed ? 'Listing Open' : 'Listing Closed'}
                                                            </span>
                                                            <button
                                                                onClick={async () => {
                                                                    const newStatus = isClosed ? 'open' : 'closed';
                                                                    const confirmMsg = newStatus === 'closed'
                                                                        ? 'This will mark ALL spots as CLOSED. Continue?'
                                                                        : 'This will mark ALL spots as OPEN. Continue?';
                                                                    if (!confirm(confirmMsg)) return;

                                                                    setIsTogglingStatus(true);
                                                                    try {
                                                                        // Fetch all spots for this listing
                                                                        const aTag = `${KINDS.LISTED_PARKING_METADATA}:${listing.pubkey}:${listing.d}`;
                                                                        const toggleQueryStart = Date.now();
                                                                        const spotEvents = await pool.querySync(DEFAULT_RELAYS, {
                                                                            kinds: [KINDS.PARKING_SPOT_LISTING],
                                                                            '#a': [aTag]
                                                                        });
                                                                        const toggleQueryLatency = Date.now() - toggleQueryStart;
                                                                        DEFAULT_RELAYS.forEach(relay => relayHealthMonitor.recordSuccess(relay, toggleQueryLatency));

                                                                        // Calculate new Snapshot Stats immediately
                                                                        const snapshotStats = {
                                                                            car: { open: 0, occupied: 0, total: 0, closed: 0, rate: 0 },
                                                                            motorcycle: { open: 0, occupied: 0, total: 0, closed: 0, rate: 0 },
                                                                            bicycle: { open: 0, occupied: 0, total: 0, closed: 0, rate: 0 }
                                                                        };

                                                                        // Publish status log (Kind 1714) for each spot AND aggregate snapshot
                                                                        // ... existing loop ... 
                                                                        // Note: We need to preserve the rate from existing stats if possible, or recalculate
                                                                        const currentStats = listingStats.get(listing.d);

                                                                        const promises = spotEvents.map(async (spot) => {
                                                                            const spotD = spot.tags.find((t: string[]) => t[0] === 'd')?.[1];
                                                                            let type = spot.tags.find((t: string[]) => t[0] === 'type')?.[1]?.toLowerCase() as 'car' | 'motorcycle' | 'bicycle' || 'car';
                                                                            if (!['car', 'motorcycle', 'bicycle'].includes(type)) type = 'car';

                                                                            const spotATag = `${KINDS.PARKING_SPOT_LISTING}:${spot.pubkey}:${spotD}`;

                                                                            // Update stats
                                                                            if (snapshotStats[type]) {
                                                                                snapshotStats[type].total++;
                                                                                if (newStatus === 'closed') snapshotStats[type].closed++;
                                                                                else snapshotStats[type].open++;

                                                                                // Preserve or fetch rates? For snapshot, rate is average/min?
                                                                                // Using currentStats rates to persist UI values 
                                                                                if (currentStats && currentStats[type]) {
                                                                                    snapshotStats[type].rate = currentStats[type].rate;
                                                                                }
                                                                            }

                                                                            // Get rate for this spot type
                                                                            const spotRate = listing.rates?.[type]?.hourly || currentStats?.[type]?.rate || 0;
                                                                            const spotCurrency = listing.rates?.[type]?.currency || 'USD';

                                                                            // Compute 5-char geohash for search compatibility
                                                                            const [lat, lon] = listing.location.split(',').map((s: string) => parseFloat(s.trim()));
                                                                            // Create full 10-char geohash for hierarchical route queries
                                                                            const fullGeohash = encodeGeohash(lat, lon, 10);

                                                                            const statusEvent = {
                                                                                kind: KINDS.LISTED_SPOT_LOG,
                                                                                created_at: Math.floor(Date.now() / 1000),
                                                                                tags: [
                                                                                    ['a', spotATag],
                                                                                    ['a', aTag, '', 'root'],
                                                                                    ['status', newStatus],
                                                                                    ['updated_by', pubkey],
                                                                                    // Hierarchical geohash tags (1-10 chars) for flexible route queries
                                                                                    ...Array.from({ length: 10 }, (_, i) => ['g', fullGeohash.substring(0, i + 1)]),
                                                                                    ['location', listing.location],
                                                                                    ['type', type],
                                                                                    ['hourly_rate', String(spotRate)],
                                                                                    ['currency', spotCurrency],
                                                                                    ['client', 'parlens']
                                                                                ],
                                                                                content: JSON.stringify({
                                                                                    hourly_rate: spotRate,
                                                                                    currency: spotCurrency
                                                                                })
                                                                            };
                                                                            const signed = await signEvent(statusEvent);
                                                                            return pool.publish(DEFAULT_RELAYS, signed);
                                                                        });

                                                                        await Promise.allSettled(promises);

                                                                        // Update listing metadata
                                                                        const newTags = listing.originalEvent.tags.filter((t: string[]) => t[0] !== 'status');
                                                                        newTags.push(['status', newStatus]);

                                                                        const metaEvent = {
                                                                            ...listing.originalEvent,
                                                                            created_at: Math.floor(Date.now() / 1000),
                                                                            tags: newTags
                                                                        };
                                                                        const signedMeta = await signEvent(metaEvent);
                                                                        await Promise.allSettled(pool.publish(DEFAULT_RELAYS, signedMeta));

                                                                        // NO Local Updates (Relay Only)

                                                                        // Wait for propagation (1.5s) then Silent Refresh
                                                                        await new Promise(resolve => setTimeout(resolve, 1500));
                                                                        await fetchListings(true);

                                                                    } catch (e) {
                                                                        console.error('Failed to update status:', e);
                                                                        alert('Failed to update status');
                                                                    } finally {
                                                                        setIsTogglingStatus(false);
                                                                    }
                                                                }}
                                                                className={`relative h-7 w-12 rounded-full transition-colors ${!isClosed ? 'bg-green-500' : 'bg-zinc-200 dark:bg-white/10'}`}
                                                            >
                                                                <span className={`block h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${!isClosed ? 'translate-x-[26px]' : 'translate-x-[4px]'}`} />
                                                            </button>
                                                        </div>
                                                    )
                                                }
                                            </div>
                                        );
                                    })}
                                    {/* Load More Button */}
                                    {displayedCount < filteredListings.length && (
                                        <button
                                            onClick={() => setDisplayedCount(prev => prev + 10)}
                                            className="flex items-center justify-center gap-1 w-full py-3 rounded-full border transition-colors text-sm font-bold bg-zinc-100 dark:bg-white/5 border-transparent text-zinc-500 active:bg-zinc-200 dark:active:bg-white/10"
                                        >
                                            Load More
                                        </button>
                                    )}
                                </>
                            )}
                        </div>
                    </>
                )}
            </div>

            {/* Create Listing Modal */}
            {
                showCreateForm && (
                    <CreateListingModal
                        editing={editingListing}
                        spotStatuses={spotStatuses}
                        currentLocation={currentLocation}
                        countryCode={countryCode}
                        onPickLocation={onPickLocation}
                        pickedLocation={pickedLocation}
                        onClose={() => { setShowCreateForm(false); setEditingListing(null); }}
                        onCreated={() => { setShowCreateForm(false); setEditingListing(null); fetchListings(); }}
                    />
                )
            }

            {/* Spot Details */}
            {
                selectedSpot && selectedListing && (
                    <SpotDetailsModal
                        spot={selectedSpot}
                        listing={listings.find(l => l.d === selectedSpot!.a.split(':')[2])!}
                        status={spotStatuses.get(selectedSpot!.d)}
                        isManager={listings.find(l => l.d === selectedSpot!.a.split(':')[2])!.owners.includes(pubkey || '') || listings.find(l => l.d === selectedSpot!.a.split(':')[2])!.managers.includes(pubkey || '')}
                        listingStats={listingStats}
                        setListingStats={setListingStats}
                        setSpotStatuses={setSpotStatuses}
                        onSpotUpdate={() => fetchListings(true)}
                        onClose={() => setSelectedSpot(null)}
                    />
                )
            }

            {/* Access List Modal */}
            {
                showAccessListModal && (
                    <AccessListModal
                        listing={showAccessListModal}
                        onClose={() => setShowAccessListModal(null)}
                    />
                )
            }
        </div >
    );
};

// Create Form Component
const CreateListingModal: React.FC<any> = ({ editing, spotStatuses, onClose, onCreated, currentLocation, countryCode, onPickLocation, pickedLocation }) => {
    const { pubkey, signEvent, pool } = useAuth();
    const [step, setStep] = useState(1);
    const [isSaving, setIsSaving] = useState(false);
    const [showNewFloorForm, setShowNewFloorForm] = useState(false); // UI State for Add Floor

    // Parse initial floors if editing
    const initialFloors = useMemo(() => {
        if (!editing?.floor_plan) return [];
        return editing.floor_plan;
    }, [editing]);

    const [formData, setFormData] = useState({
        listing_name: editing?.listing_name || '',
        website: editing?.website || '',
        location: editing?.location || '',
        local_area: editing?.local_area || '',
        city: editing?.city || '',
        zipcode: editing?.zipcode || '',
        country: editing?.country || '',
        listing_type: editing?.listing_type || 'private',
        qr_type: editing?.qr_type || 'static',
        owners: editing?.owners?.join(', ') || '',
        managers: editing?.managers?.join(', ') || '',
        members: editing?.members?.join(', ') || '',
        relays: editing?.relays?.join(', ') || '',
        currency: 'USD'
    });

    const [floors, setFloors] = useState<any[]>(initialFloors);
    const [newFloor, setNewFloor] = useState({
        name: '',
        counts: { car: 0, motorcycle: 0, bicycle: 0 },
        rates: { car: 0, motorcycle: 0, bicycle: 0 }
    });

    // Initialize currency
    useEffect(() => {
        if (!editing && countryCode) {
            const map: any = { 'US': 'USD', 'GB': 'GBP', 'EU': 'EUR', 'IN': 'INR' };
            setFormData(prev => ({ ...prev, currency: map[countryCode] || 'USD' }));
        } else if (editing?.rates?.car?.currency) {
            setFormData(prev => ({ ...prev, currency: editing.rates.car.currency }));
        }
    }, [countryCode, editing]);

    // Update location from pick and validate currency
    useEffect(() => {
        if (pickedLocation) {
            setFormData(prev => ({ ...prev, location: `${pickedLocation.lat.toFixed(6)}, ${pickedLocation.lon.toFixed(6)} ` }));

            // Validate currency
            getCurrencyFromLocation(pickedLocation.lat, pickedLocation.lon).then(curr => {
                if (curr && curr !== formData.currency) {
                    // Just auto-switch if no currency set yet, or prompt?
                    // For simplicity, just set it if it's the first set (or user hasn't manually changed it much).
                    // Or better, set it and let user change back if needed.
                    setFormData(prev => ({ ...prev, currency: curr }));
                }
            });
        }
    }, [pickedLocation]);

    // Scroll to top on step change
    useEffect(() => {
        const modalContent = document.getElementById('create-listing-content');
        if (modalContent) modalContent.scrollTo({ top: 0, behavior: 'smooth' });
    }, [step]);

    // Lock body scroll when modal is open (prevents background scrolling)
    useEffect(() => {
        const originalOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => {
            document.body.style.overflow = originalOverflow;
        };
    }, []);

    // Helper to render Npub chips
    const renderNpubChips = (value: string) => {
        if (!value) return null;
        const items = value.split(',').map(s => s.trim()).filter(Boolean);
        if (items.length === 0) return null;
        return (
            <div className="flex flex-wrap gap-2 mt-2">
                {items.map((item, i) => (
                    <span key={i} className="px-2 py-1 bg-zinc-200 dark:bg-white/10 rounded-lg text-[10px] font-mono text-zinc-600 dark:text-zinc-400 flex items-center gap-1 max-w-full">
                        <span className="truncate max-w-[150px]">{item}</span>
                    </span>
                ))}
            </div>
        );
    };

    const addFloor = () => {
        if (!newFloor.name) return;
        setFloors([...floors, { ...newFloor, id: crypto.randomUUID() }]);
        setNewFloor(prev => ({ ...prev, name: '', counts: { car: 0, motorcycle: 0, bicycle: 0 } })); // Keep rates for convenience
    };

    const removeFloor = (index: number) => {
        setFloors(floors.filter((_, i) => i !== index));
    };

    const handleSubmit = async () => {
        if (!formData.listing_name) return;

        // Auto-add pending floor if user forgot to click "Add Floor"
        let finalFloors = [...floors];
        if (newFloor.name && (newFloor.counts.car > 0 || newFloor.counts.motorcycle > 0 || newFloor.counts.bicycle > 0)) {
            // If the form is OPEN and valid, auto-save it
            if (showNewFloorForm) {
                finalFloors.push({ ...newFloor, id: crypto.randomUUID() });
            }
        }

        if (finalFloors.length === 0) {
            alert('Please add at least one floor with parking spots.');
            return;
        }

        let geohash = '';
        if (formData.location) {
            const [lat, lon] = formData.location.split(',').map((s: string) => parseFloat(s.trim()));
            if (!isNaN(lat) && !isNaN(lon)) geohash = encodeGeohash(lat, lon, 10);
        }

        const listingId = (editing?.d || crypto.randomUUID()).trim();
        const parseList = (s: string) => s.split(',').map(x => x.trim()).filter(Boolean).map(p => {
            if (p.startsWith('npub')) {
                try {
                    const { data } = nip19.decode(p);
                    return data as string;
                } catch (e) { console.error('Invalid npub:', p); return p; }
            }
            return p;
        });

        // Compute totals and rates for display
        let totalSpots = 0;
        const displayRates: any = {};
        // Use the first floor with a rate as the display rate, or just use the first floor
        // Iterate to find rates
        // Use the first floor with a rate as the display rate, or just use the first floor
        // Iterate to find rates
        finalFloors.forEach(f => {
            totalSpots += (f.counts.car || 0) + (f.counts.motorcycle || 0) + (f.counts.bicycle || 0);
            // Capture rates even if 0 (free parking) - only skip if not defined
            if (!displayRates.car && f.rates.car !== undefined) displayRates.car = { hourly: f.rates.car || 0, currency: formData.currency };
            if (!displayRates.motorcycle && f.rates.motorcycle !== undefined) displayRates.motorcycle = { hourly: f.rates.motorcycle || 0, currency: formData.currency };
            if (!displayRates.bicycle && f.rates.bicycle !== undefined) displayRates.bicycle = { hourly: f.rates.bicycle || 0, currency: formData.currency };
        });

        const metadata = {
            kind: KINDS.LISTED_PARKING_METADATA,
            created_at: Math.floor(Date.now() / 1000),
            tags: [
                ['d', listingId],
                ['listing_name', formData.listing_name.slice(0, 25)],
                ['location', formData.location],
                ['g', geohash],
                // Add hierarchical geohash tags (1-10 chars) for flexible route queries
                ...Array.from({ length: Math.min(geohash.length, 10) }, (_, i) => ['g', geohash.substring(0, i + 1)]).filter(tag => tag[1].length < geohash.length),
                ['local_area', formData.local_area || ''],
                ['city', formData.city || ''],
                ['zipcode', formData.zipcode || ''],
                ['country', formData.country || ''],
                ['floors', finalFloors.map(f => f.name).join(', ')],
                ['floor_plan', JSON.stringify(finalFloors)],
                ['total_spots', String(totalSpots + (editing && !editing.floor_plan ? (editing.total_spots || 0) : 0))], // Handle legacy edit edge case delicately, but sticking to logic
                ['rates', JSON.stringify(displayRates)],
                ['listing_type', formData.listing_type],
                ['qr_type', formData.qr_type],
                ['client', 'parlens'],
                ...parseList(formData.owners).map(p => ['p', p, 'admin']),
                ...parseList(formData.managers).map(p => ['p', p, 'write']),
                ...parseList(formData.members).map(p => ['p', p, 'read']),
                ...parseList(formData.relays).map(r => ['relay', r])
            ],
            content: ''
        };


        // Safety Check: Only self-promote to 'admin' if creating new or already an owner.
        // Managers editing (if they somehow access this) should NOT become owners.
        const isCreator = !editing;
        const isAlreadyOwner = editing && editing.owners.includes(pubkey || '');

        if ((isCreator || isAlreadyOwner) && !metadata.tags.find(t => t[0] === 'p' && t[1] === pubkey && t[2] === 'admin')) {
            metadata.tags.push(['p', pubkey, 'admin']);
        }

        setIsSaving(true);
        try {
            await Promise.allSettled(pool.publish(DEFAULT_RELAYS, await signEvent(metadata)));

            // Check if ANY metadata changed that affects spots (Location, Type, Name, QR Type) -> Update all linked spots
            if (editing) {
                try {
                    const aTag = `${KINDS.LISTED_PARKING_METADATA}:${pubkey}:${listingId}`;
                    // Fetch all spots for this listing
                    const spotEvents = await pool.querySync(DEFAULT_RELAYS, { kinds: [KINDS.PARKING_SPOT_LISTING], '#a': [aTag] });

                    console.log(`[Parlens] Found ${spotEvents.length} spots to sync with new metadata`);

                    const updatePromises = spotEvents.map(async (spot: any) => {
                        const spotD = spot.tags.find((t: string[]) => t[0] === 'd')?.[1];
                        if (!spotD) return;

                        // 1. Update Spot Definition (Kind 37141) with new location/geohash/type
                        let newTags = spot.tags.filter((t: string[]) =>
                            t[0] !== 'location' && t[0] !== 'g' && t[0] !== 'type'
                        );

                        // Add new/updated tags
                        newTags.push(['location', formData.location]);
                        newTags.push(['g', geohash]);
                        // Add hierarchical g tags (1-10 chars)
                        for (let i = 1; i < Math.min(geohash.length, 10); i++) {
                            newTags.push(['g', geohash.substring(0, i + 1)]);
                        }

                        // Preserve original type if not changing, but we should probably enforce consistency?
                        // For now, let's keep the spot's own type unless we want to enforce bulk updates.
                        // Actually, looking at the code below, 'type' is read from the spot tags.
                        // If we want to support changing listing type, does it affect spot types? 
                        // Typically 'listing_type' (public/private) is separate from 'spot type' (car/moto).
                        // BUT, if we needed to propagate anything else, do it here.
                        // Re-inject the type tag we filtered out:
                        let type = spot.tags.find((t: string[]) => t[0] === 'type')?.[1] || 'car';
                        newTags.push(['type', type]);


                        const newSpotEvent = {
                            kind: KINDS.PARKING_SPOT_LISTING,
                            created_at: Math.floor(Date.now() / 1000),
                            tags: newTags,
                            content: spot.content
                        };

                        // 2. Update Status Log (Kind 1714) with new location/name/qr_type details
                        const currentStatus = spotStatuses?.get(spotD)?.status || 'open';

                        const spotATagForLog = `${KINDS.PARKING_SPOT_LISTING}:${pubkey}:${spotD}`;
                        const [lat, lon] = formData.location.split(',').map((s: string) => parseFloat(s.trim()));
                        const spotRate = displayRates[type]?.hourly || 0;
                        const spotCurrency = displayRates[type]?.currency || formData.currency;
                        const fullGeohash = encodeGeohash(lat, lon, 10);

                        const newStatusEvent = {
                            kind: KINDS.LISTED_SPOT_LOG,
                            created_at: Math.floor(Date.now() / 1000) + 1, // +1s to ensure it's seen as newer than any potential race
                            tags: [
                                ['a', spotATagForLog],
                                ['a', aTag, '', 'root'],
                                ['status', currentStatus],
                                ['updated_by', pubkey],
                                // Hierarchical geohash tags
                                ...Array.from({ length: 10 }, (_, i) => ['g', fullGeohash.substring(0, i + 1)]),
                                ['location', formData.location],
                                ['type', type],
                                ['hourly_rate', String(spotRate)],
                                ['currency', spotCurrency],
                                ['listing_name', formData.listing_name],
                                ['qr_type', formData.qr_type || 'static'], // Propagate QR Type
                                ['client', 'parlens']
                            ],
                            content: JSON.stringify({ hourly_rate: spotRate, currency: spotCurrency })
                        };

                        // Sign and Publish both
                        await Promise.all([
                            pool.publish(DEFAULT_RELAYS, await signEvent(newSpotEvent)),
                            pool.publish(DEFAULT_RELAYS, await signEvent(newStatusEvent))
                        ]);
                    });

                    await Promise.allSettled(updatePromises);

                } catch (e) {
                    console.error('[Parlens] Failed to cascade updates to spots:', e);
                }
            }

            // Dispatch global update event to trigger map refresh
            window.dispatchEvent(new Event('parlens-listing-updated'));

            // Create spots
            if (!editing) {
                let globalNum = 1;
                for (const floor of finalFloors) {
                    for (const [type, count] of Object.entries(floor.counts)) {
                        console.log(`[Parlens] Floor ${floor.name} Type ${type} Count ${count}`);
                        for (let i = 0; i < (count as number); i++) {
                            const spotId = `${listingId}-spot-${globalNum}`;
                            const aTag = `${KINDS.LISTED_PARKING_METADATA}:${pubkey}:${listingId}`;
                            const spot = {
                                kind: KINDS.PARKING_SPOT_LISTING,
                                created_at: Math.floor(Date.now() / 1000),
                                tags: [
                                    ['d', spotId], ['a', aTag],
                                    ['spot_number', String(globalNum)],
                                    ['floor', floor.name],
                                    ['type', type],
                                    ['location', formData.location], ['g', geohash], ['client', 'parlens']
                                ],
                                content: `${formData.listing_name} #${globalNum}`
                            };
                            await Promise.allSettled(pool.publish(DEFAULT_RELAYS, await signEvent(spot)));

                            // Publish initial Kind 1714 status (open)
                            try {
                                const spotATagForLog = `${KINDS.PARKING_SPOT_LISTING}:${pubkey}:${spotId}`;
                                const [lat, lon] = formData.location.split(',').map((s: string) => parseFloat(s.trim()));
                                const spotRate = displayRates[type]?.hourly || 0;
                                const spotCurrency = displayRates[type]?.currency || formData.currency;
                                // Create full 10-char geohash for hierarchical route queries
                                const fullGeohash = encodeGeohash(lat, lon, 10);

                                const initialStatus = {
                                    kind: KINDS.LISTED_SPOT_LOG,
                                    created_at: Math.floor(Date.now() / 1000),
                                    tags: [
                                        ['a', spotATagForLog],
                                        ['a', aTag, '', 'root'],
                                        ['status', 'open'],
                                        ['updated_by', pubkey],
                                        // Hierarchical geohash tags (1-10 chars) for flexible route queries
                                        ...Array.from({ length: 10 }, (_, i) => ['g', fullGeohash.substring(0, i + 1)]),
                                        ['location', formData.location],
                                        ['type', type],
                                        ['hourly_rate', String(spotRate)],
                                        ['currency', spotCurrency],
                                        ['listing_name', formData.listing_name],
                                        ['client', 'parlens']
                                    ],
                                    content: JSON.stringify({ hourly_rate: spotRate, currency: spotCurrency })
                                };
                                await Promise.allSettled(pool.publish(DEFAULT_RELAYS, await signEvent(initialStatus)));
                            } catch (e) {
                                console.warn('[Parlens] Failed to publish initial status for spot:', spotId, e);
                            }
                            globalNum++;
                        }
                    }
                }
            }
            onCreated();
        } catch (e) {
            console.error('Failed to save listing:', e);
            alert('Failed to save listing. Please try again.');
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[4000] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
            <div id="create-listing-content" className="w-full max-w-lg bg-white dark:bg-[#1c1c1e] rounded-3xl p-6 shadow-2xl overflow-y-auto max-h-[90vh]">
                {isSaving && (
                    <div className="absolute inset-0 z-50 bg-white/50 dark:bg-black/50 backdrop-blur-[2px] flex flex-col items-center justify-center rounded-3xl">
                        <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mb-3"></div>
                        <div className="text-zinc-900 dark:text-white font-bold animate-pulse">Saving Listing...</div>
                    </div>
                )}
                <div className="flex justify-between items-center mb-6">
                    <h2 className="text-xl font-bold text-zinc-900 dark:text-white">{editing ? 'Edit Listing' : 'Create Listing'}</h2>
                    <button onClick={onClose}><X className="text-zinc-500 dark:text-white" /></button>
                </div>

                {step === 1 ? (
                    <div className="space-y-4">
                        <div className="space-y-1">
                            <label className="text-xs font-bold uppercase text-zinc-400 ml-1">Listing Name<InfoTooltip title="Listing Name" text="Maximum 25 characters" /></label>
                            <input
                                className="w-full p-3 bg-zinc-100 dark:bg-white/5 rounded-xl text-zinc-900 dark:text-white placeholder:text-zinc-400"
                                placeholder="560038 Public Parking"
                                value={formData.listing_name}
                                maxLength={25}
                                onChange={e => setFormData({ ...formData, listing_name: e.target.value })}
                            />
                        </div>
                        <div className="space-y-1">
                            <label className="text-xs font-bold uppercase text-zinc-400 ml-1">Location<InfoTooltip title="Location" text="If you are listing an individual spot, mark location as the centre of the spot. If you are listing multiple street parking spots, mark mid points between junctions and create multiple listings as required to manage spots. If you are listing a lot, mark the street entrance of the lot." /></label>
                            <div className="flex gap-2">
                                <input className="flex-1 min-w-0 p-3 bg-zinc-100 dark:bg-white/5 rounded-xl text-zinc-900 dark:text-white placeholder:text-zinc-400" placeholder="lat, lon" value={formData.location} onChange={e => setFormData({ ...formData, location: e.target.value })} />
                                <button onClick={currentLocation ? () => setFormData({ ...formData, location: `${currentLocation[0].toFixed(6)}, ${currentLocation[1].toFixed(6)}` }) : undefined} className="shrink-0 p-3 bg-blue-500/10 text-blue-500 rounded-xl"><LocateFixed size={20} /></button>
                                {onPickLocation && <button onClick={onPickLocation} className="shrink-0 p-3 bg-orange-500/10 text-orange-600 dark:text-orange-400 border border-orange-500/20 rounded-xl"><MapPin size={20} /></button>}
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-2">
                            <div className="space-y-1">
                                <label className="text-xs font-bold uppercase text-zinc-400 ml-1">Local Area</label>
                                <input className="w-full p-3 bg-zinc-100 dark:bg-white/5 rounded-xl text-zinc-900 dark:text-white placeholder:text-zinc-400" placeholder="Indiranagar" value={formData.local_area} onChange={e => setFormData({ ...formData, local_area: e.target.value })} />
                            </div>
                            <div className="space-y-1">
                                <label className="text-xs font-bold uppercase text-zinc-400 ml-1">City</label>
                                <input className="w-full p-3 bg-zinc-100 dark:bg-white/5 rounded-xl text-zinc-900 dark:text-white placeholder:text-zinc-400" placeholder="Bangalore" value={formData.city} onChange={e => setFormData({ ...formData, city: e.target.value })} />
                            </div>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                            <div className="space-y-1">
                                <label className="text-xs font-bold uppercase text-zinc-400 ml-1">Zipcode</label>
                                <input className="w-full p-3 bg-zinc-100 dark:bg-white/5 rounded-xl text-zinc-900 dark:text-white placeholder:text-zinc-400" placeholder="560038" value={formData.zipcode} onChange={e => setFormData({ ...formData, zipcode: e.target.value })} />
                            </div>
                            <div className="space-y-1">
                                <label className="text-xs font-bold uppercase text-zinc-400 ml-1">Country</label>
                                <input className="w-full p-3 bg-zinc-100 dark:bg-white/5 rounded-xl text-zinc-900 dark:text-white placeholder:text-zinc-400" placeholder="India" value={formData.country} onChange={e => setFormData({ ...formData, country: e.target.value })} />
                            </div>
                        </div>

                        <div className="space-y-1">
                            <label className="text-xs font-bold uppercase text-zinc-400 ml-1">Access Type<InfoTooltip title="Access Type" text="Public listings require approval before they are visible to users. You must begin using Parlens QR authentication to manage spots in your parking to qualify for approval. Use the drop down filter in the My Listings page to view public listings by approval status." /></label>
                            <div className="grid grid-cols-2 gap-2">
                                <button onClick={() => setFormData({ ...formData, listing_type: 'private' })} className={`p-3 rounded-xl font-bold transition-colors ${formData.listing_type === 'private' ? 'bg-purple-500 text-white' : 'bg-zinc-100 text-zinc-600 dark:bg-white/5 dark:text-white'}`}>Private</button>
                                <button onClick={() => setFormData({ ...formData, listing_type: 'public' })} className={`p-3 rounded-xl font-bold transition-colors ${formData.listing_type === 'public' ? 'bg-green-500 text-white' : 'bg-zinc-100 text-zinc-600 dark:bg-white/5 dark:text-white'}`}>Public</button>
                            </div>
                        </div>

                        <div className="space-y-1">
                            <label className="text-xs font-bold uppercase text-zinc-400 ml-1">QR Code Type<InfoTooltip title="QR Code Type" text="QR codes enable users to update spot statuses through one time authentication. Static QR codes remain the same after each parking session and are ideal for self-managed lots, like visitor parking in an apartment or an office parking lot, where user trust is high. Dynamic QR codes are updated after each log status update and are ideal for large lots that are open to the public. Dynamic QRs prevent users from taking a photograph of the QR to update spot status at a later time." /></label>
                            <div className="p-4 bg-zinc-50 dark:bg-white/5 rounded-2xl">
                                <div className="flex gap-4">
                                    <label className="flex items-center gap-2 text-zinc-900 dark:text-white font-medium text-sm"><input type="radio" checked={formData.qr_type === 'static'} onChange={() => setFormData({ ...formData, qr_type: 'static' })} /> Static</label>
                                    <label className="flex items-center gap-2 text-zinc-900 dark:text-white font-medium text-sm"><input type="radio" checked={formData.qr_type === 'dynamic'} onChange={() => setFormData({ ...formData, qr_type: 'dynamic' })} /> Dynamic</label>
                                </div>
                            </div>
                        </div>

                        {formData.listing_type === 'private' && (
                            <>
                                <div className="space-y-1">
                                    <label className="text-xs font-bold uppercase text-zinc-400 ml-1">Members</label>
                                    <input className="w-full p-3 bg-zinc-100 dark:bg-white/5 rounded-xl text-zinc-900 dark:text-white placeholder:text-zinc-400" placeholder="Pubkeys (comma separated)" value={formData.members} onChange={e => setFormData({ ...formData, members: e.target.value })} />
                                    {renderNpubChips(formData.members)}
                                </div>
                                <div className="space-y-1">
                                    <label className="text-xs font-bold uppercase text-zinc-400 ml-1">Relays<InfoTooltip title="Relays" text="Events related to this listing will only be published in the specified relays, if no relays are specified events are published to users' preferred relays. Please ensure all members, managers and owners are subscribed to the respective relays, if specified." /></label>
                                    <input className="w-full p-3 bg-zinc-100 dark:bg-white/5 rounded-xl text-zinc-900 dark:text-white placeholder:text-zinc-400" placeholder="URLs (comma separated)" value={formData.relays} onChange={e => setFormData({ ...formData, relays: e.target.value })} />
                                </div>
                            </>
                        )}

                        <div className="space-y-2">
                            <div className="space-y-1">
                                <label className="text-xs font-bold uppercase text-zinc-400 ml-1">Owners<InfoTooltip title="Owners" text="Owners can edit all listing or spot details and manage access." /></label>
                                <input className="w-full p-3 bg-zinc-100 dark:bg-white/5 rounded-xl text-zinc-900 dark:text-white placeholder:text-zinc-400" placeholder="Pubkeys (comma separated)" value={formData.owners} onChange={e => setFormData({ ...formData, owners: e.target.value })} />
                                {renderNpubChips(formData.owners)}
                            </div>
                            <div className="space-y-1">
                                <label className="text-xs font-bold uppercase text-zinc-400 ml-1">Managers<InfoTooltip title="Managers" text="Managers can edit spot status logs." /></label>
                                <input className="w-full p-3 bg-zinc-100 dark:bg-white/5 rounded-xl text-zinc-900 dark:text-white placeholder:text-zinc-400" placeholder="Pubkeys (comma separated)" value={formData.managers} onChange={e => setFormData({ ...formData, managers: e.target.value })} />
                                {renderNpubChips(formData.managers)}
                            </div>
                        </div>

                        <button onClick={() => setStep(2)} className="w-full py-3 bg-[#007AFF] text-white rounded-xl font-bold flex items-center justify-center gap-2">Next <ChevronRight size={16} /></button>
                    </div>
                ) : (
                    <div className="space-y-6">
                        <div className="flex justify-between items-center">
                            <h3 className="font-bold text-zinc-900 dark:text-white">Floors & Spots</h3>
                            <select
                                className="pl-3 pr-8 py-2 bg-zinc-100 dark:bg-white/5 border border-black/5 dark:border-white/10 rounded-xl text-zinc-900 dark:text-white text-sm font-medium appearance-none focus:outline-none focus:ring-2 focus:ring-blue-500 bg-[url('data:image/svg+xml;charset=UTF-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2212%22%20height%3D%2212%22%20viewBox%3D%220%200%2012%2012%22%3E%3Cpath%20fill%3D%22%23888%22%20d%3D%22M2%204l4%204%204-4z%22%2F%3E%3C%2Fsvg%3E')] bg-no-repeat bg-[right_0.75rem_center]"
                                value={formData.currency}
                                onChange={e => setFormData({ ...formData, currency: e.target.value })}
                            >
                                <option value="USD">USD ($)</option>
                                <option value="EUR">EUR (€)</option>
                                <option value="GBP">GBP (£)</option>
                                <option value="INR">INR (₹)</option>
                                <option value="JPY">JPY (¥)</option>
                                <option value="CAD">CAD (C$)</option>
                                <option value="AUD">AUD (A$)</option>
                                <option value="CNY">CNY (¥)</option>
                                <option value="AED">AED (د.إ)</option>
                                <option value="SGD">SGD (S$)</option>
                                <option value="CHF">CHF (Fr)</option>
                                <option value="HKD">HKD (HK$)</option>
                                <option value="SEK">SEK (kr)</option>
                                <option value="NOK">NOK (kr)</option>
                                <option value="DKK">DKK (kr)</option>
                                <option value="NZD">NZD (NZ$)</option>
                                <option value="MXN">MXN ($)</option>
                                <option value="BRL">BRL (R$)</option>
                                <option value="ZAR">ZAR (R)</option>
                                <option value="KRW">KRW (₩)</option>
                                <option value="THB">THB (฿)</option>
                                <option value="MYR">MYR (RM)</option>
                                <option value="PHP">PHP (₱)</option>
                                <option value="IDR">IDR (Rp)</option>
                                <option value="VND">VND (₫)</option>
                                <option value="RUB">RUB (₽)</option>
                                <option value="PLN">PLN (zł)</option>
                                <option value="TRY">TRY (₺)</option>
                                <option value="SAR">SAR (﷼)</option>
                                <option value="EGP">EGP (E£)</option>
                            </select>
                        </div>

                        {/* List Floors */}
                        <div className="space-y-3">
                            {floors.map((floor, idx) => (
                                <div key={idx} className="p-3 bg-zinc-50 dark:bg-white/5 rounded-xl flex justify-between items-center group touch-none">
                                    <div className="flex-1 min-w-0 mr-2" onClick={() => {
                                        // Edit functionality: Remove from list and load into form
                                        if (showNewFloorForm) {
                                            alert("Please save or cancel current floor edit first");
                                            return;
                                        }
                                        removeFloor(idx);
                                        setNewFloor(floor);
                                        setShowNewFloorForm(true);
                                    }}>
                                        <div className="font-bold dark:text-white truncate">{floor.name}</div>
                                        <div className="text-xs text-zinc-500 truncate">
                                            {floor.counts.car > 0 && `🚗 ${floor.counts.car} `}
                                            {floor.counts.motorcycle > 0 && `🏍️ ${floor.counts.motorcycle} `}
                                            {floor.counts.bicycle > 0 && `🚲 ${floor.counts.bicycle} `}
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-1">
                                        <button onClick={() => {
                                            if (showNewFloorForm) { alert("Finish current floor first"); return; }
                                            removeFloor(idx); setNewFloor(floor); setShowNewFloorForm(true);
                                        }} className="p-2 text-zinc-400 hover:text-blue-500 transition-colors">
                                            <Pencil size={18} />
                                        </button>
                                        <button onClick={() => removeFloor(idx)} style={{ WebkitTapHighlightColor: 'transparent' }} className="p-2 text-zinc-400">
                                            <Trash2 size={18} />
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>

                        {/* New Floor Form */}
                        {showNewFloorForm ? (
                            <div className="p-4 border border-blue-500/30 bg-blue-50/50 dark:bg-blue-900/10 rounded-2xl space-y-4">
                                <h4 className="font-bold text-sm text-zinc-900 dark:text-white">New Floor Details</h4>
                                <div className="space-y-1">
                                    <label className="text-xs font-bold uppercase text-zinc-400 ml-1">Floor Name</label>
                                    <input className="w-full p-2 bg-white dark:bg-white/5 rounded-lg text-zinc-900 dark:text-white border border-zinc-200 dark:border-white/10" placeholder="e.g. B1, Ground" value={newFloor.name} onChange={e => setNewFloor({ ...newFloor, name: e.target.value })} />
                                </div>

                                {['car', 'motorcycle', 'bicycle'].map((type) => (
                                    <div key={type} className="flex items-center gap-3">
                                        <span className="text-2xl w-8">{type === 'car' ? '🚗' : type === 'motorcycle' ? '🏍️' : '🚲'}</span>
                                        <div className="flex-1">
                                            <label className="text-[10px] font-bold uppercase text-zinc-400">Spots</label>
                                            <input type="number" className="w-full p-1 bg-white dark:bg-white/5 rounded text-zinc-900 dark:text-white border border-zinc-200 dark:border-white/10" placeholder="0" value={newFloor.counts[type as keyof typeof newFloor.counts] || ''} onChange={(e) => setNewFloor(prev => ({ ...prev, counts: { ...prev.counts, [type]: parseInt(e.target.value) || 0 } }))} />
                                        </div>
                                        <div className="flex-1">
                                            <label className="text-[10px] font-bold uppercase text-zinc-400">Hourly Rate</label>
                                            <input type="number" className="w-full p-1 bg-white dark:bg-white/5 rounded text-zinc-900 dark:text-white border border-zinc-200 dark:border-white/10" placeholder="0" value={newFloor.rates[type as keyof typeof newFloor.rates] || ''} onChange={(e) => setNewFloor(prev => ({ ...prev, rates: { ...prev.rates, [type]: parseFloat(e.target.value) || 0 } }))} />
                                        </div>
                                    </div>
                                ))}

                                <div className="flex gap-2">
                                    <button
                                        onClick={() => setShowNewFloorForm(false)}
                                        className="flex-1 py-2 bg-zinc-200 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 rounded-xl font-bold text-sm"
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        onClick={() => {
                                            addFloor();
                                            setShowNewFloorForm(false);
                                        }}
                                        className="flex-1 py-2 bg-blue-500 text-white rounded-xl font-bold text-sm"
                                    >
                                        Save Floor
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <button
                                onClick={() => setShowNewFloorForm(true)}
                                className="w-full py-4 border-2 border-dashed border-zinc-200 dark:border-white/10 rounded-2xl text-zinc-400 font-bold hover:bg-zinc-50 dark:hover:bg-white/5 transition-colors"
                            >
                                + Add Floor
                            </button>
                        )}

                        <div className="flex gap-2 pt-2">
                            <button onClick={() => setStep(1)} className="flex-1 py-3 bg-zinc-200 dark:bg-white/10 text-zinc-800 dark:text-white rounded-xl font-bold">Back</button>
                            <button onClick={handleSubmit} className="flex-1 py-3 bg-[#007AFF] text-white rounded-xl font-bold">Save Listing</button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

const SpotDetailsModal: React.FC<any> = ({ spot, listing, status, onClose, isManager, listingStats, setListingStats, setSpotStatuses, onSpotUpdate, ...props }) => {
    const { pubkey, signEvent, pool } = useAuth();
    const isApprover = pubkey === APPROVER_PUBKEY;
    // QR contains a-tag, authorizer (owner/manager pubkey), auth token, and metadata for Kind 1714 publishing
    const spotATag = `${KINDS.PARKING_SPOT_LISTING}:${spot.pubkey}:${spot.d}`;
    // For static QR, auth token is fixed; for dynamic, it would regenerate
    // Include spot metadata for search discovery when user scans QR
    const listingLocation = listing.location ? listing.location.split(',').map((n: string) => parseFloat(n.trim())) : undefined;
    const listingATag = `${KINDS.LISTED_PARKING_METADATA}:${listing.pubkey}:${listing.d}`;
    const qrAuthData = JSON.stringify({
        a: spotATag,
        listingATag, // Parent listing address for Parking Log reference
        authorizer: listing.owners?.[0] || pubkey,
        auth: `static - ${spot.d}`, // Static token based on spot d-tag
        // Metadata for Kind 1714 tags
        listingName: listing.listing_name,
        floor: spot.floor || '', // Floor name
        spotNumber: spot.spot_number,
        shortName: spot.short_name,
        listingLocation: listingLocation,
        spotType: spot.type || 'car',
        hourlyRate: spot.rates?.hourly || listing.rates?.[spot.type]?.hourly || 0,
        currency: spot.rates?.currency || listing.rates?.[spot.type]?.currency || listing.rates?.car?.currency || 'INR'
    });
    const [copied, setCopied] = useState(false);
    const [isEditing, setIsEditing] = useState(false);
    const [editData, setEditData] = useState({
        short_name: spot.short_name || '',
        type: spot.type,
        rate: spot.rates?.hourly || 0
    });

    // Status log & Notes state
    const [logs, setLogs] = useState<any[]>([]);
    const [notes, setNotes] = useState<Map<string, any[]>>(new Map()); // Map logId -> notes[]
    const [logsLoading, setLogsLoading] = useState(true);
    const [quickNote, setQuickNote] = useState('');
    const [showLogs, setShowLogs] = useState(false);
    const [isUpdating, setIsUpdating] = useState(false);

    // Fetch logs and notes (extracted for reuse)
    const fetchData = useCallback(async () => {
        if (!pool) return;
        setLogsLoading(true);
        try {
            // Fetch Logs (1714) and Notes (1417) linked to this spot
            const events = await pool.querySync(DEFAULT_RELAYS, {
                kinds: [KINDS.LISTED_SPOT_LOG, KINDS.PRIVATE_LOG_NOTE],
                '#a': [spotATag],
                limit: 50 // Increase limit to catch enough history
            });

            const fetchedLogs = events.filter((e: any) => e.kind === KINDS.LISTED_SPOT_LOG)
                .sort((a: any, b: any) => b.created_at - a.created_at);

            const fetchedNotes = events.filter((e: any) => e.kind === KINDS.PRIVATE_LOG_NOTE);

            // Map notes to their target log event (e-tag)
            const notesMap = new Map<string, any[]>();
            fetchedNotes.forEach((note: any) => {
                const eTag = note.tags.find((t: string[]) => t[0] === 'e')?.[1];
                if (eTag) {
                    const existing = notesMap.get(eTag) || [];
                    existing.push(note);
                    notesMap.set(eTag, existing);
                }
            });

            setLogs(fetchedLogs);
            setNotes(notesMap);
        } catch (e) {
            console.error('Failed to fetch spot history:', e);
        } finally {
            setLogsLoading(false);
        }
    }, [pool, spotATag]);

    // Fetch on mount
    useEffect(() => {
        if (isManager || isApprover) fetchData();
    }, [fetchData, isManager, isApprover]);

    const update = async (s: 'occupied' | 'open' | 'closed') => {
        setIsUpdating(true);
        try {
            const content = JSON.stringify({
                status: s,
                hourly_rate: spot.rates?.hourly || 0,
                currency: spot.rates?.currency || 'USD',
                type: spot.type || 'car',
                updated_at: Math.floor(Date.now() / 1000)
            });

            const listingATag = `${KINDS.LISTED_PARKING_METADATA}:${listing.pubkey}:${listing.d}`;
            const tags = [
                ['a', spotATag],
                ['a', listingATag, '', 'root'],
                ['status', s],
                ['updated_by', pubkey],
                ['client', 'parlens']
            ];

            // Add search metadata tags - use hierarchical 1-10 char geohash for route queries
            if (listing.location) {
                tags.push(['location', listing.location]);
                const [lat, lon] = listing.location.split(',').map(Number);
                // Add 1-10 char geohash tags for flexible prefix matching
                const fullGeohash = encodeGeohash(lat, lon, 10);
                for (let i = 1; i <= 10; i++) {
                    tags.push(['g', fullGeohash.substring(0, i)]);
                }
            }
            // Add type tag for filtering
            if (spot.type) tags.push(['type', spot.type]);
            // Add rate tags for map display
            tags.push(['hourly_rate', String(spot.rates?.hourly || 0)]);
            tags.push(['currency', spot.rates?.currency || 'USD']);
            // Add relay tags for discoverability
            DEFAULT_RELAYS.forEach(relay => tags.push(['r', relay]));

            const ev = {
                kind: KINDS.LISTED_SPOT_LOG, created_at: Math.floor(Date.now() / 1000),
                tags: tags,
                content: content
            };
            const signed = await signEvent(ev);
            await Promise.allSettled(pool.publish(DEFAULT_RELAYS, signed));

            // NO Optimistic Updates. Wait for Relay.
            await new Promise(resolve => setTimeout(resolve, 1500));

            // Refresh Local Logs (for Modal UI)
            await fetchData();

            // Refresh Global Stats (Parent)
            if ((props as any).onSpotUpdate) {
                (props as any).onSpotUpdate();
            }

        } catch (e) {
            console.error('Failed to update spot:', e);
            alert('Failed to update status');
        } finally {
            setIsUpdating(false);
        }
    };


    const addQuickNote = async (targetLogId?: string, content?: string) => {
        const textToAdd = content || quickNote;
        if (!textToAdd.trim()) return;

        // Default to latest log if no target specified
        const logId = targetLogId || logs[0]?.id;
        if (!logId) {
            alert("No activity log found to attach note to.");
            return;
        }

        const noteEvent = {
            kind: KINDS.PRIVATE_LOG_NOTE,
            created_at: Math.floor(Date.now() / 1000),
            tags: [
                ['e', logId],
                ['a', spotATag],
                ['a', listingATag],
                ['p', pubkey],
                ['client', 'parlens']
            ],
            content: textToAdd // Unencrypted for now per plan
        };

        try {
            const signed = await signEvent(noteEvent);
            await Promise.allSettled(pool.publish(DEFAULT_RELAYS, signed));
            if (!content) setQuickNote(''); // Only clear main input if used main input

            // Update local notes map
            setNotes(prev => {
                const newMap = new Map(prev);
                const existing = newMap.get(logId) || [];
                newMap.set(logId, [...existing, signed]);
                return newMap;
            });
        } catch (e) {
            alert('Failed to add note');
        }
    };

    const handleSaveEdit = async () => {
        // ... (Same Edit Logic) ...
        const tags = [
            ['d', spot.d], ['a', spot.a],
            ['spot_number', spot.spot_number],
            ['floor', spot.floor || ''],
            ['type', editData.type],
            ['short_name', editData.short_name],
            ['location', spot.location],
            ['g', spot.g],
            ['client', 'parlens']
        ];
        if (editData.rate) { /* logic placeholder if rate added */ }

        const ev = {
            kind: KINDS.PARKING_SPOT_LISTING,
            created_at: Math.floor(Date.now() / 1000),
            tags: tags,
            content: editData.short_name || `${listing.listing_name} #${spot.spot_number} `
        };

        await Promise.allSettled(pool.publish(DEFAULT_RELAYS, await signEvent(ev)));
        // Refresh via parent - this is spot metadata edit, not status change
        setIsEditing(false);
    };

    if (isEditing) {
        // ... (Same Edit View) ...
        return (
            <div className="fixed inset-0 z-[5000] bg-black/80 flex items-center justify-center p-4 text-center" onClick={onClose}>
                <div className="bg-white dark:bg-[#1c1c1e] rounded-3xl p-6 w-full max-w-sm space-y-4 relative" onClick={e => e.stopPropagation()}>
                    <button onClick={() => setIsEditing(false)} className="absolute top-4 right-4 p-2 rounded-full text-zinc-400 hover:text-zinc-600 dark:text-white/40 dark:hover:text-white/60">
                        <X size={20} />
                    </button>
                    <h2 className="text-xl font-bold text-zinc-900 dark:text-white">Edit Spot</h2>
                    <div className="space-y-2 text-left">
                        <label className="text-xs font-bold uppercase text-zinc-400">Name / Short Code</label>
                        <input className="w-full p-3 bg-zinc-100 dark:bg-white/5 rounded-xl dark:text-white" value={editData.short_name} onChange={e => setEditData({ ...editData, short_name: e.target.value })} placeholder={`#${spot.spot_number} `} />
                        <label className="text-xs font-bold uppercase text-zinc-400">Type</label>
                        <select
                            className="w-full p-3 bg-zinc-100 dark:bg-white/5 rounded-xl dark:text-white appearance-none bg-[url('data:image/svg+xml;charset=UTF-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2212%22%20height%3D%2212%22%20viewBox%3D%220%200%2012%2012%22%3E%3Cpath%20fill%3D%22%23888%22%20d%3D%22M2%204l4%204%204-4z%22%2F%3E%3C%2Fsvg%3E')] bg-no-repeat bg-[right_1rem_center]"
                            style={{ WebkitTapHighlightColor: 'transparent' }}
                            value={editData.type}
                            onChange={e => setEditData({ ...editData, type: e.target.value as any })}
                        >
                            <option value="car">🚗 Car</option><option value="motorcycle">🏍️ Motorcycle</option><option value="bicycle">🚲 Bicycle</option>
                        </select>
                    </div>
                    <div className="flex gap-2">
                        <button onClick={() => setIsEditing(false)} className="flex-1 py-3 bg-zinc-200 dark:bg-white/10 text-zinc-800 dark:text-white rounded-xl font-bold">Cancel</button>
                        <button onClick={handleSaveEdit} className="flex-1 py-3 bg-[#007AFF] text-white rounded-xl font-bold">Save</button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="fixed inset-0 z-[5000] bg-black/80 flex items-center justify-center p-4 text-center" onClick={onClose}>
            <div className="bg-white dark:bg-[#1c1c1e] rounded-3xl p-6 w-full max-w-sm space-y-4 relative max-h-[85vh] overflow-y-auto min-h-[400px]" onClick={e => e.stopPropagation()}>
                {isUpdating && (
                    <div className="fixed inset-0 z-[6000] flex items-center justify-center bg-black/60 backdrop-blur-sm flex-col animate-in fade-in duration-200">
                        <div className="animate-spin w-10 h-10 border-4 border-white/20 border-t-white rounded-full"></div>
                        <div className="text-white font-bold mt-4 animate-pulse">Updating Status...</div>
                    </div>
                )}

                {/* LOG VIEW MODE */}
                {showLogs ? (
                    <div className="flex flex-col h-full space-y-4 animate-in fade-in slide-in-from-right-4">
                        <div className="flex items-center justify-between">
                            <button onClick={() => setShowLogs(false)} className="p-2 -ml-2 rounded-full text-zinc-600 dark:text-white hover:bg-black/5 dark:hover:bg-white/10">
                                <ArrowLeft size={24} />
                            </button>
                            <h3 className="font-bold text-lg text-zinc-900 dark:text-white">Status Log</h3>
                            <div className="w-10"></div> {/* Spacer for alignment */}
                        </div>


                        <div className="flex-1 overflow-y-auto space-y-3 min-h-[300px]">
                            {logsLoading ? (
                                <div className="text-center text-zinc-400 py-8">Loading logs...</div>
                            ) : logs.length === 0 ? (
                                <div className="text-center text-zinc-400 py-8 flex flex-col items-center gap-2">
                                    <div className="text-4xl opacity-20">📜</div>
                                    <p>No activity yet</p>
                                </div>
                            ) : (
                                logs.map((log: any, i: number) => {
                                    const s = log.tags?.find((t: string[]) => t[0] === 'status')?.[1];
                                    const updatedBy = log.tags?.find((t: string[]) => t[0] === 'updated_by')?.[1];
                                    const authorizer = log.tags?.find((t: string[]) => t[0] === 'authorizer')?.[1];
                                    const date = new Date(log.created_at * 1000);
                                    const logNotes = notes.get(log.id) || [];

                                    return (
                                        <div key={log.id || i} className="p-4 bg-zinc-50 dark:bg-white/5 rounded-2xl text-left border border-black/5 dark:border-white/5">
                                            <div className="flex items-center justify-between mb-2">
                                                <div className={`font - bold capitalize flex items - center gap - 2 ${s === 'open' ? 'text-green-500' : s === 'occupied' ? 'text-red-500' : 'text-zinc-500'} `}>
                                                    <div className={`w - 2 h - 2 rounded - full ${s === 'open' ? 'bg-green-500' : s === 'occupied' ? 'bg-red-500' : 'bg-zinc-500'} `} />
                                                    {s || 'unknown'}
                                                </div>
                                                <div className="text-xs text-zinc-400 font-medium tabular-nums">
                                                    {date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} • {date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
                                                </div>
                                            </div>

                                            <div className="text-xs text-zinc-500 dark:text-white/40 flex flex-col gap-1">
                                                <div>By: {updatedBy ? (updatedBy === pubkey ? 'You' : `${updatedBy.slice(0, 8)}...`) : 'Unknown'}</div>
                                                {authorizer && <div>Auth: {authorizer.slice(0, 8)}...</div>}
                                            </div>

                                            {/* Note Input for specific log - Only for Managers (not Approvers) */}
                                            {isManager && (
                                                <>
                                                    <div className="mt-2 flex gap-2">
                                                        <input
                                                            id={`note-input-${log.id}`}
                                                            placeholder="Add a note"
                                                            className="flex-1 p-2.5 bg-white dark:bg-white/10 rounded-xl text-sm text-zinc-900 dark:text-white border border-black/5 dark:border-white/10 focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder:text-zinc-400"
                                                            onKeyDown={(e) => {
                                                                if (e.key === 'Enter' && (e.target as HTMLInputElement).value.trim()) {
                                                                    addQuickNote(log.id, (e.target as HTMLInputElement).value);
                                                                    (e.target as HTMLInputElement).value = '';
                                                                }
                                                            }}
                                                        />
                                                        <button
                                                            onClick={() => {
                                                                const input = document.getElementById(`note-input-${log.id}`) as HTMLInputElement;
                                                                if (input && input.value.trim()) {
                                                                    addQuickNote(log.id, input.value);
                                                                    input.value = '';
                                                                }
                                                            }}
                                                            className="p-2.5 bg-[#007AFF] text-white rounded-xl"
                                                        >
                                                            <Plus size={20} />
                                                        </button>
                                                    </div>

                                                    {/* Notes attached to this log */}
                                                    {logNotes.length > 0 && (
                                                        <div className="mt-3 space-y-2 pt-3 border-t border-black/5 dark:border-white/5">
                                                            {logNotes.map((n: any) => (
                                                                <div key={n.id} className="text-xs bg-yellow-50 dark:bg-yellow-900/10 p-2 rounded-lg text-zinc-700 dark:text-yellow-100/80">
                                                                    {n.content}
                                                                </div>
                                                            ))}
                                                        </div>
                                                    )}
                                                </>
                                            )}
                                        </div>
                                    );
                                })
                            )}
                        </div>
                    </div>
                ) : (
                    /* MAIN DETAILS VIEW */
                    <>
                        <button onClick={onClose} className="absolute top-4 right-4 p-2 rounded-full text-zinc-400 hover:text-zinc-600 dark:text-white/40 dark:hover:text-white/60">
                            <X size={20} />
                        </button>

                        <h2 className="text-xl font-bold text-zinc-900 dark:text-white pr-8 text-left">{spot.short_name || spot.content}</h2>

                        {/* Auth QR Code - Only visible to managers/owners */}
                        {isManager && (
                            <>
                                <div className="p-4 rounded-3xl flex justify-center">
                                    <QRCodeSVG
                                        value={qrAuthData}
                                        size={180}
                                        level="M"
                                        bgColor="transparent"
                                        fgColor="currentColor"
                                        className="text-black dark:text-white"
                                    />
                                </div>
                                <div onClick={() => { navigator.clipboard.writeText(qrAuthData); setCopied(true); setTimeout(() => setCopied(false), 2000); }} className="flex justify-center items-center gap-2 text-[#007AFF] font-bold cursor-pointer py-2 hover:opacity-80 transition-opacity">
                                    {copied ? <Check size={18} /> : <Copy size={18} />} {copied ? 'Copied' : 'Copy Auth Code'}
                                </div>
                            </>
                        )}

                        <div className="grid grid-cols-2 gap-3 text-left">
                            <div className="p-4 bg-zinc-50 dark:bg-white/5 rounded-2xl">
                                <div className="text-xs font-bold uppercase text-zinc-400 mb-1">Rate</div>
                                <div className="text-lg font-bold text-zinc-900 dark:text-white tabular-nums">{getCurrencySymbol(spot.rates?.currency || listing.rates?.car?.currency || 'USD')}{spot.rates?.hourly || listing.rates?.[spot.type]?.hourly}/hr</div>
                            </div>
                            <div className="p-4 bg-zinc-50 dark:bg-white/5 rounded-2xl">
                                <div className="text-xs font-bold uppercase text-zinc-400 mb-1">Status</div>
                                {/* Use LATEST log status if available, fallback to props */}
                                {(() => {
                                    const latestLog = logs.length > 0 ? logs[0] : null;
                                    const latestLogStatus = latestLog?.tags.find((t: string[]) => t[0] === 'status')?.[1];

                                    let displayStatus;
                                    // Robust timestamp comparison to handle race conditions
                                    if (latestLog && status) {
                                        // Use whichever is newer
                                        displayStatus = latestLog.created_at >= status.created_at ? latestLogStatus : status.status;
                                    } else {
                                        displayStatus = latestLogStatus || status?.status;
                                    }

                                    if (!displayStatus && logsLoading) {
                                        return <div className="text-lg font-bold text-zinc-400 animate-pulse">...</div>;
                                    }

                                    const finalStatus = displayStatus || 'open';

                                    return (
                                        <div className={`text-lg font-bold capitalize ${finalStatus === 'occupied' ? 'text-red-500' : finalStatus === 'closed' ? 'text-zinc-500' : 'text-green-500'}`}>
                                            {finalStatus}
                                        </div>
                                    );
                                })()}
                            </div>
                        </div>

                        {/* Latest Note Display & Quick Add (Main View) - Only for Managers/Owners */}
                        {isManager && (
                            <div className="p-4 bg-zinc-50 dark:bg-white/5 rounded-2xl text-left space-y-2">
                                <div className="text-xs font-bold uppercase text-zinc-400 mb-1">Latest Note</div>
                                {(() => {
                                    // Find latest note across all logs
                                    let latestNote: any = null;
                                    let latestNoteTime = 0;
                                    notes.forEach((noteList: any[]) => {
                                        noteList.forEach((n: any) => {
                                            if (n.created_at > latestNoteTime) {
                                                latestNote = n;
                                                latestNoteTime = n.created_at;
                                            }
                                        });
                                    });

                                    return latestNote ? (
                                        <div className="text-sm dark:text-white italic">"{latestNote.content}" <span className="text-xs text-zinc-400 not-italic">- {new Date(latestNote.created_at * 1000).toLocaleDateString()}</span></div>
                                    ) : (
                                        <div className="text-sm text-zinc-400 italic">No notes added yet</div>
                                    );
                                })()}

                                <div className="flex gap-2 pt-2">
                                    <input
                                        value={quickNote}
                                        onChange={e => setQuickNote(e.target.value)}
                                        placeholder="Add a note"
                                        className="flex-1 p-2.5 bg-white dark:bg-white/10 rounded-xl text-sm text-zinc-900 dark:text-white border border-black/5 dark:border-white/10 focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder:text-zinc-400"
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter') addQuickNote();
                                        }}
                                    />
                                    <button
                                        onClick={() => addQuickNote()}
                                        disabled={!quickNote.trim()}
                                        className="p-2.5 bg-[#007AFF] text-white rounded-xl disabled:opacity-50"
                                    >
                                        <Plus size={20} />
                                    </button>
                                </div>
                            </div>
                        )}

                        {(isManager || isApprover) && (
                            <div className="space-y-4 pt-2">
                                {/* Spot Control Buttons - Manager Only */}
                                {isManager && (
                                    <div className="flex gap-2">
                                        <button onClick={() => update('open')} className="flex-1 py-3 bg-green-500/10 border border-green-500/20 text-green-600 dark:text-green-400 font-bold text-sm rounded-xl active:scale-95 transition-all">Open</button>
                                        <button onClick={() => update('occupied')} className="flex-1 py-3 bg-red-500/10 border border-red-500/20 text-red-500 font-bold text-sm rounded-xl active:scale-95 transition-all">Occupied</button>
                                        <button onClick={() => update('closed')} className="flex-1 py-3 bg-zinc-500/10 border border-zinc-500/20 text-zinc-500 dark:text-zinc-400 font-bold text-sm rounded-xl active:scale-95 transition-all">Closed</button>
                                    </div>
                                )}

                                {/* Status Log Button - Main Entry Point for Notes/History */}
                                <button
                                    onClick={() => setShowLogs(true)}
                                    className="w-full py-4 bg-blue-500/10 border border-blue-500/20 text-[#007AFF] font-bold rounded-2xl flex items-center justify-center gap-2 active:scale-[0.98] transition-transform"
                                >
                                    View Status Log <ChevronRight size={18} />
                                </button>

                                {/* Edit/Delete Buttons - Manager Only */}
                                {isManager && (
                                    <div className="flex gap-3 pt-2 border-t border-black/5 dark:border-white/5">
                                        <button onClick={() => setIsEditing(true)} style={{ WebkitTapHighlightColor: 'transparent' }} className="flex-1 py-3 bg-zinc-100 dark:bg-white/10 border border-zinc-200 dark:border-white/10 text-zinc-600 dark:text-zinc-300 font-bold text-sm flex items-center justify-center gap-2 rounded-xl transition-transform active:scale-95">
                                            <Pencil size={16} /> Edit
                                        </button>
                                        <button onClick={async () => {
                                            if (!confirm('Delete this spot?')) return;
                                            try {
                                                const del = {
                                                    kind: 5,
                                                    pubkey: pubkey,
                                                    created_at: Math.floor(Date.now() / 1000),
                                                    tags: [['e', spot.id]],
                                                    content: 'deleted'
                                                };
                                                await Promise.allSettled(pool.publish(DEFAULT_RELAYS, await signEvent(del)));
                                                onClose();
                                            } catch (e) { alert('Failed to delete'); }
                                        }} style={{ WebkitTapHighlightColor: 'transparent' }} className="mt-0 p-3 bg-red-500/10 border border-red-500/20 text-red-500 rounded-xl active:scale-95 transition-transform flex items-center justify-center">
                                            <Trash2 size={20} /> <span className="hidden sm:inline">Delete</span>
                                        </button>
                                    </div>
                                )}
                            </div>
                        )}
                    </>
                )
                }
            </div >
        </div >
    );
};

// Access List Modal Component
const AccessListModal: React.FC<{ listing: ListedParkingMetadata; onClose: () => void }> = ({ listing, onClose }) => {
    // Helper to render sections
    const renderSection = (title: string, pubkeys: string[]) => {
        if (!pubkeys || pubkeys.length === 0) return null;
        return (
            <div className="space-y-2">
                <div className="text-xs font-bold uppercase text-zinc-400 tracking-wider">{title}</div>
                <div className="space-y-1">
                    {pubkeys.map(pk => (
                        <div key={pk} className="flex items-center justify-between p-3 bg-zinc-50 dark:bg-white/5 rounded-xl">
                            <div className="flex flex-col overflow-hidden">
                                {pk.startsWith('npub') ? (
                                    <div className="text-xs font-mono truncate max-w-[200px] text-zinc-600 dark:text-zinc-300">{pk}</div>
                                ) : (
                                    <div className="text-xs font-mono truncate max-w-[200px] text-zinc-600 dark:text-zinc-300">
                                        {(() => { try { return nip19.npubEncode(pk); } catch (e) { return pk; } })()}
                                    </div>
                                )}
                            </div>
                            <button onClick={() => {
                                const val = pk.startsWith('npub') ? pk : (() => { try { return nip19.npubEncode(pk); } catch (e) { return pk; } })();
                                navigator.clipboard.writeText(val);
                                alert('Copied');
                            }} className="p-2 text-blue-500 bg-blue-500/10 rounded-full hover:bg-blue-500/20 active:scale-95 transition-all">
                                <Copy size={16} />
                            </button>
                        </div>
                    ))}
                </div>
            </div>
        );
    };

    return (
        <div className="fixed inset-0 z-[5000] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in" onClick={onClose}>
            <div className="bg-white dark:bg-[#1c1c1e] rounded-3xl p-6 w-full max-w-sm space-y-6 relative border border-black/5 dark:border-white/10 shadow-2xl" onClick={e => e.stopPropagation()}>
                <div className="flex justify-between items-center">
                    <h2 className="text-xl font-bold dark:text-white">Access List</h2>
                    <button onClick={onClose}><X className="text-zinc-400 hover:text-zinc-600 dark:hover:text-white" /></button>
                </div>

                <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-2">
                    {renderSection('Owners', listing.owners)}
                    {renderSection('Managers', listing.managers)}
                    {renderSection('Members', listing.members)}
                    {renderSection('Relays', listing.relays || [])}

                    {(!listing.owners?.length && !listing.managers?.length && !listing.members?.length) && (
                        <div className="text-center text-zinc-400 py-8">No access details found</div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default ListedParkingPage;
