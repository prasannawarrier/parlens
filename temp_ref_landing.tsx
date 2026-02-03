/**
 * Landing Page with Pure MapLibre GL JS
 * Replaces Leaflet for native vector map rotation and smooth zoom
 */
import React, { useState, useEffect, useRef, useCallback, memo, useMemo } from 'react';
import { HelpCircle, X, MapPin, Locate, ChevronUp, ChevronDown, ArrowUp } from 'lucide-react';
import Map, { Marker, Source, Layer, type MapRef } from 'react-map-gl/maplibre';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { FAB } from '../components/FAB';
import { ProfileButton } from '../components/ProfileButton';
import { RouteButton } from '../components/RouteButton';
import { clusterSpots, isCluster } from '../lib/clustering';
import { getCurrencySymbol } from '../lib/currency';
import { StableLocationTracker, LocationSmoother, PositionAnimator, BearingAnimator } from '../lib/locationSmoothing';
import { useWakeLock } from '../hooks/useWakeLock';

// Free vector tile styles - using simpler styles that match better
const MAP_STYLES = {
    light: 'https://tiles.openfreemap.org/styles/positron',
    dark: 'https://tiles.openfreemap.org/styles/dark'
};





// Restored Stable SpotMarkerContent
const SpotMarkerContent = memo(({ price, emoji, currency, isHistory = false }: { price: number, emoji: string, currency: string, isHistory?: boolean }) => {
    const symbol = getCurrencySymbol(currency);
    return (
        <div className="flex flex-col items-center justify-center cursor-pointer transition-transform active:scale-95">
            <div className="text-[32px] leading-none drop-shadow-md z-10 filter">
                {emoji}
            </div>
            <div
                className={`
                    px-2 py-0.5 rounded-full text-[11px] font-bold text-white shadow-md border-[1.5px] border-white -mt-1.5 z-0 whitespace-nowrap
                    ${isHistory ? 'bg-zinc-500' : 'bg-[#34C759]'}
                `}
            >
                {symbol}{Math.round(price)}/hr
            </div>
        </div>
    );
});


// User Location Marker Component
const UserLocationMarker = memo(({ bearing, mapBearing, isNavigationMode }: { bearing: number; mapBearing: number; isNavigationMode: boolean }) => {
    // In navigation mode, map is rotated "Up" (Bearing). User matches Bearing. Relative = 0.
    // In fixed mode, Map Bearing is B. User Heading is H.
    // Screen Up is -B. Screen User Dir is H.
    // We want arrow to point H relative to screen.
    // Marker rotates with map? If yes, it points -B (Map North).
    // We need to rotate it R such that -B + R = H  =>  R = H + B ?
    // No, react-map-gl Marker is screen-aligned (rotationAlignment="auto" -> "viewport").
    // So Marker Up is Screen Up (0).
    // We want Marker to point H relative to screen.
    // But H is absolute (0=North).
    // Simplified Rotation Logic:
    // Auto/Navigation Mode: Map rotates. Marker Points UP (Relative 0).
    // Fixed Mode: Map is Fixed (0 or user-set). Marker Points Compass Bearing.

    // In AutoMode: We pass "bearing" (Smoothed User Heading) to the map as the bearing.
    // So the Map rotates such that "North" is at -Bearing.
    // The screen "Forward" is Bearing.
    // So the marker should just point UP (0).

    // Unified Rotation Logic:
    // Always calculate targetRotation = bearing - mapBearing.
    // In Fixed Mode: mapBearing is roughly constant (0 or set). Bearing rotates. Marker rotates.
    // In Auto Mode: mapBearing follows Bearing. Ideally targetRotation = 0.
    // BUT due to animation lag, mapBearing might lag behind Bearing.
    // By using (Bearing - MapBearing), the marker points to the TRUE Bearing relative to Screen/Map.
    // If Map lags by 5deg, Marker points 5deg right (True North). This masks the lag.

    const targetRotation = bearing - mapBearing;

    // Shortest Path Logic
    const rotationRef = useRef(0);
    const lastTargetRef = useRef(0);
    const diff = targetRotation - lastTargetRef.current;
    if (Math.abs(diff) > 180) {
        if (diff > 0) {
            rotationRef.current -= 360;
        } else {
            rotationRef.current += 360;
        }
    }
    lastTargetRef.current = targetRotation;
    const finalRotation = targetRotation + rotationRef.current;


    const scale = isNavigationMode ? 1 : 1;

    return (
        <div
            style={{
                transform: `rotate(${finalRotation}deg) scale(${scale})`,
                transition: 'transform 0.2s ease-out', // Re-enabled to smooth out compass noise
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                pointerEvents: 'none'
            }}
        >
            <div
                style={{
                    width: 28,
                    height: 28,
                    background: '#007AFF',
                    border: '3px solid white',
                    borderRadius: '50%',
                    boxShadow: `0 0 0 ${isNavigationMode ? 3 : 2}px rgba(0,122,255,${isNavigationMode ? 0.5 : 0.4}), 0 4px 12px rgba(0,0,0,0.4)`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                }}
            >
                {/* Arrow always points UP relative to the rotation container */}
                <svg width="14" height="14" viewBox="0 0 14 14" style={{ transform: 'translateY(-1px)' }}>
                    <path d="M7 0L14 14L7 12L0 14L7 0Z" fill="white" />
                </svg>
            </div>
        </div>
    );
});
UserLocationMarker.displayName = 'UserLocationMarker';



// Cluster Marker Component
const ClusterMarkerContent = memo(({ count, minPrice, maxPrice, currency, type }: {
    count: number; minPrice: number; maxPrice: number; currency: string; type: 'open' | 'history'
}) => {
    const emoji = type === 'open' ? '🅿️' : '🅟';
    const isHistory = type === 'history';
    const symbol = getCurrencySymbol(currency);
    const priceRange = minPrice === maxPrice ? `${symbol}${minPrice}` : `${symbol}${minPrice}-${maxPrice}`;

    return (
        <div className="flex flex-col items-center justify-center cursor-pointer transition-transform active:scale-95 pointer-events-none">
            <div className="relative text-[32px] leading-none drop-shadow-md z-10 filter">
                {emoji}
                {/* Count Badge */}
                <div className={`
                    absolute -top-1 -right-1 flex items-center justify-center min-w-[18px] h-[18px] px-1
                    text-[10px] font-bold text-white rounded-full border-2 border-white shadow-sm
                    ${isHistory ? 'bg-zinc-500' : 'bg-[#34C759]'}
                `}>
                    {count}
                </div>
            </div>
            <div
                className={`
                    px-2 py-0.5 rounded-full text-[11px] font-bold text-white shadow-md border-[1.5px] border-white -mt-1.5 z-0 whitespace-nowrap
                    ${isHistory ? 'bg-zinc-500' : 'bg-[#34C759]'}
                `}
            >
                {priceRange}/hr
            </div>
        </div>
    );
});
ClusterMarkerContent.displayName = 'ClusterMarkerContent';

// Active Session Marker (Map Icon)
const ActiveSessionMarkerContent = memo(({ vehicleType }: { vehicleType: 'bicycle' | 'motorcycle' | 'car' }) => {
    // Only the emoji marker on the map
    const emoji = vehicleType === 'bicycle' ? '🚲' : vehicleType === 'motorcycle' ? '🏍️' : '🚗';
    return (
        <div style={{ fontSize: 36, filter: 'drop-shadow(0 4px 8px rgba(0,0,0,0.4))', pointerEvents: 'none' }}>
            {emoji}
        </div>
    );
});
ActiveSessionMarkerContent.displayName = 'ActiveSessionMarkerContent';

// Collapsible Vehicle Toggle Component
const VehicleToggle = memo(({
    vehicleType,
    onVehicleChange,
    disabled
}: {
    vehicleType: 'bicycle' | 'motorcycle' | 'car';
    onVehicleChange: (type: 'bicycle' | 'motorcycle' | 'car') => void;
    disabled: boolean;
}) => {
    const [isExpanded, setIsExpanded] = useState(false);
    const vehicles = ['bicycle', 'motorcycle', 'car'] as const;
    const emojis = { bicycle: '🚲', motorcycle: '🏍️', car: '🚗' };

    return (
        <div className="flex flex-col rounded-[2rem] bg-white/80 dark:bg-white/10 backdrop-blur-md border border-black/5 dark:border-white/10 shadow-lg mb-2 overflow-hidden transition-all duration-300">
            {isExpanded ? (
                // Expanded: show all vehicle options
                <div className="flex flex-col gap-1 p-1">
                    {vehicles.map((type) => (
                        <button
                            key={type}
                            onClick={() => {
                                if (!disabled) {
                                    onVehicleChange(type);
                                    setIsExpanded(false);
                                } else if (disabled) {
                                    alert('Please end your current session before changing vehicle type.');
                                }
                            }}
                            className={`w-10 h-10 rounded-full flex items-center justify-center transition-all ${vehicleType === type
                                ? 'bg-blue-500/20 shadow-inner'
                                : 'transition-colors'
                                }`}
                        >
                            <span className={`text-lg ${vehicleType === type ? '' : 'opacity-50'}`}>
                                {emojis[type]}
                            </span>
                        </button>
                    ))}
                    {/* Collapse arrow */}
                    <button
                        onClick={() => setIsExpanded(false)}
                        className="w-10 h-6 flex items-center justify-center text-zinc-400 dark:text-white/40 transition-colors"
                    >
                        <ChevronUp size={16} />
                    </button>
                </div>
            ) : (
                // Collapsed: show only selected vehicle + expand arrow
                <button
                    onClick={() => setIsExpanded(true)}
                    className="flex flex-col items-center p-1 transition-all"
                >
                    <div className="w-10 h-10 rounded-full flex items-center justify-center bg-blue-500/20">
                        <span className="text-lg">{emojis[vehicleType]}</span>
                    </div>
                    <ChevronDown size={14} className="text-zinc-400 dark:text-white/40 mt-0.5" />
                </button>
            )}
        </div>
    );
});
VehicleToggle.displayName = 'VehicleToggle';

// Main Landing Page Component
export const LandingPage: React.FC = () => {
    const mapRef = useRef<MapRef>(null);
    const [location, setLocation] = useState<[number, number] | null>(null);
    const locationSmoother = useRef(new LocationSmoother());
    // Use BearingAnimator for map rotation to prevent 0/360 flip flickering
    const bearingAnimator = useRef(new BearingAnimator());
    // Animator for marker position
    const positionAnimator = useRef(new PositionAnimator());
    const [locationError, setLocationError] = useState<string | null>(null);

    const [status, setStatus] = useState<'idle' | 'search' | 'parked'>('idle');
    const [orientationMode, setOrientationMode] = useState<'fixed' | 'recentre' | 'auto'>('fixed');
    const [pendingAutoMode, setPendingAutoMode] = useState(false); // Immediate visual feedback for button
    const [showHelp, setShowHelp] = useState(false);
    // Currency state - removed (logic in FAB)
    const [vehicleType, setVehicleType] = useState<'bicycle' | 'motorcycle' | 'car'>(() => {
        const saved = localStorage.getItem('parlens_vehicle_type');
        return (saved === 'bicycle' || saved === 'motorcycle' || saved === 'car') ? saved : 'car';
    });
    const [openSpots, setOpenSpots] = useState<any[]>([]);
    const [historySpots, setHistorySpots] = useState<any[]>([]);
    const [parkLocation, setParkLocation] = useState<[number, number] | null>(null);
    const [needsRecenter, setNeedsRecenter] = useState(false);
    const [zoomLevel, setZoomLevel] = useState(17);
    const [routeCoords, setRouteCoords] = useState<[number, number][] | null>(null);
    const [alternateRouteCoords, setAlternateRouteCoords] = useState<[number, number][] | null>(null);
    const [routeWaypoints, setRouteWaypoints] = useState<{ lat: number; lon: number }[] | null>(null);
    const [showRoute, setShowRoute] = useState(false);
    const [dropPinMode, setDropPinMode] = useState(false);
    const [pendingDropPin, setPendingDropPin] = useState<{ lat: number; lon: number } | null>(null);



    // Session State (Lifted from FAB)
    const [sessionStart, setSessionStart] = useState<number | null>(null);
    const [isMapLoaded, setIsMapLoaded] = useState(false);

    // MapLibre view state
    const [viewState, setViewState] = useState({
        longitude: 77.5946,
        latitude: 12.9716,
        zoom: 17,
        bearing: 0,
        pitch: 0
    });

    // Track user interaction
    const isUserInteracting = useRef(false);
    const isTransitioning = useRef(false);
    const isDarkMode = window.matchMedia('(prefers-color-scheme: dark)').matches;

    // Orientation permission state (for iOS)
    const [orientationNeedsPermission, setOrientationNeedsPermission] = useState(false);

    // Cumulative rotation for smooth bearing transitions
    const [cumulativeRotation, setCumulativeRotation] = useState(0);
    const [userHeading, setUserHeading] = useState(0); // Responsive heading for marker

    // Screen Wake Lock
    const { requestLock, releaseLock } = useWakeLock();

    // Location smoothing with dynamic buffer zones
    const locationTracker = useRef(new StableLocationTracker());
    const [_userSpeed, setUserSpeed] = useState(0); // Available for future speed indicator UI
    const initialLocationSet = useRef(false); // Track if we've set initial location
    const userSpeedRef = useRef(0); // Live speed ref for animator callback
    const latestCompassHeading = useRef(0); // Live compass heading for smooth transitions


    // Auto-switch to 'fixed' mode when Parking to prevent vibration
    // 'Auto' mode (compass) can be jittery when stationary/parked.
    // We lock map to North Up (Fixed) for stability.
    useEffect(() => {
        if (status === 'parked') {
            setOrientationMode('fixed');
            // Reset bearing to 0 for clean view
            setViewState(prev => ({ ...prev, bearing: 0, pitch: 0 }));
            mapRef.current?.rotateTo(0, { duration: 800 });
        }
    }, [status]);

    // Initialize location tracking with smoothing
    useEffect(() => {
        if (!navigator.geolocation) {
            setLocationError('Geolocation is not supported by your browser');
            return;
        }

        const watchId = navigator.geolocation.watchPosition(
            (position) => {
                const { latitude, longitude } = position.coords;

                // 1. Smooth the raw GPS coordinates using Kalman Filter
                const [smoothedLat, smoothedLon] = locationSmoother.current.smoothLocation(latitude, longitude);

                // 2. Pass smoothed coordinates to StableLocationTracker (Buffer Logic)
                const result = locationTracker.current.updateLocation(smoothedLat, smoothedLon);

                // Only update state if marker should move (outside buffer zone)
                if (result.shouldUpdate) {
                    // Use Animator to smoothly interpolate to the new position
                    // This creates 60fps movement instead of 1Hz jumps
                    // IMPORTANT: Stop any previous animation first (handled inside animateTo)
                    positionAnimator.current.animateTo(
                        result.displayLat,
                        result.displayLon,
                        result.animationDuration
                    );
                }

                // Track speed for potential UI feedback
                setUserSpeed(result.speed);
                userSpeedRef.current = result.speed;

                // GPS used for Location Interpolation (locationTracker/positionAnimator)
                // Orientation is Compass-Only (handled in handleOrientation)

                // Initialize view state ONLY on first location (using ref to avoid stale closure)
                if (!initialLocationSet.current) {
                    initialLocationSet.current = true;
                    setLocation([result.displayLat, result.displayLon]);
                    setViewState(prev => ({
                        ...prev,
                        latitude: result.displayLat,
                        longitude: result.displayLon
                    }));
                }
            },
            (error) => {
                let message = 'Unable to get your location';
                if (error.code === 1) message = 'Location access denied. Please enable location services.';
                else if (error.code === 2) message = 'Location unavailable. Check your GPS settings.';
                else if (error.code === 3) message = 'Location request timed out.';
                setLocationError(message);
            },
            {
                enableHighAccuracy: true,
                timeout: 15000,
                maximumAge: 0
            }
        );

        // Bind animator callback to state updates
        positionAnimator.current.setUpdateCallback((lat, lon) => {
            // Always update marker location
            setLocation([lat, lon]);

            // Sync Map Center in Auto Mode (Hard Lock)
            // This prevents "jitter" where the marker moves independently of the map camera
            // We use a functional update to access the latest state without closure issues
            setOrientationMode(currentMode => {
                // GUARD: If user is interacting (pinching/panning), DO NOT force update viewState
                // This prevents "fighting" the user's gestures and allows smooth zooming
                if ((currentMode === 'auto' || currentMode === 'recentre') && !isUserInteracting.current) {

                    // GUARD: Stationary Check
                    // If speed is very low (< 0.3 m/s), do not recenter automatically.
                    // This allows the user to browse the map freely when stopped
                    if (userSpeedRef.current < 0.3 && currentMode !== 'recentre') {
                        return currentMode;
                    }

                    setViewState(prev => {
                        // CRITICAL: Use LIVE zoom from map instance if available, otherwise fallback to state
                        const liveZoom = mapRef.current?.getZoom() ?? prev.zoom;



                        // Soft Follow (LERP)
                        // Move camera 10% of the distance to the target per frame.
                        // This removes the "Jitter" effect caused by frame misalignment.
                        const lerpFactor = 0.1;
                        const newLat = prev.latitude + (lat - prev.latitude) * lerpFactor;
                        const newLon = prev.longitude + (lon - prev.longitude) * lerpFactor;

                        return {
                            ...prev,
                            latitude: newLat,
                            longitude: newLon,
                            zoom: liveZoom
                        };
                    });
                }
                return currentMode;
            });
        });

        return () => {
            navigator.geolocation.clearWatch(watchId);
            positionAnimator.current.stop();
        };
    }, []);

    // Device orientation tracking
    useEffect(() => {
        // Check if orientation permission is needed (iOS 13+)
        if (typeof (DeviceOrientationEvent as any).requestPermission === 'function') {
            setOrientationNeedsPermission(true);
        }

        const handleOrientation = (event: DeviceOrientationEvent) => {
            // STOP updating orientation if user is interacting (panning/zooming)
            // This prevents React re-renders from interrupting the MapLibre gesture handling
            if (isUserInteracting.current) return;

            let heading: number | null = null;


            if ((event as any).webkitCompassHeading) {
                // iOS
                heading = (event as any).webkitCompassHeading;
            } else if (event.alpha !== null) {
                // Android (absolute)
                heading = 360 - (event.alpha as number);
            }

            if (heading !== null) {
                // Adjust for screen orientation
                // window.orientation is deprecated but required for iOS Safari
                // screen.orientation is standard
                const orientation = (window.screen as any).orientation?.angle ?? window.orientation ?? 0;

                // Add orientation angle to align compass with screen "up" (Fixes 180deg flip)
                heading = (heading + orientation) % 360;
            }



            if (heading !== null) {
                latestCompassHeading.current = heading; // Update for button transition logic
                // Noise Gate: Ignore micro-changes (< 2 degrees) to filter vibrations
                // We use a ref to store the last processed heading to compare against
                // Note: We need to handle 360 wrap-around for the diff check

                // 1. Update Marker (Heavy Smoothing for Stability)
                // Reduced factor from 0.7 (twitchy) to 0.1 (stable)
                setUserHeading(h => {
                    const diff = heading! - h;
                    let d = diff;
                    if (d > 180) d -= 360;
                    if (d < -180) d += 360;

                    // Noise Gate: If change is < 2 degrees, ignore it (return current h)
                    // limit updates to significant movements
                    if (Math.abs(d) < 2) return h;

                    return h + d * 0.1;
                });

                // 2. Update Map Smoothly (Heavy Smoothing to prevent motion sickness)
                const smoothed = locationSmoother.current.smoothBearing(heading, 0, true);
                if (smoothed !== null) {
                    // Use animator to ensure continuous rotation (handles 359->1 wrap correctly)
                    const continuous = bearingAnimator.current.setBearing(smoothed);
                    setCumulativeRotation(continuous);
                }
            }
        };

        window.addEventListener('deviceorientation', handleOrientation, true);

        return () => {
            window.removeEventListener('deviceorientation', handleOrientation, true);
        };
    }, []);

    // Request orientation permission (iOS)
    const requestOrientationPermission = async () => {
        if (typeof (DeviceOrientationEvent as any).requestPermission === 'function') {
            const permission = await (DeviceOrientationEvent as any).requestPermission();
            if (permission === 'granted') {
                setOrientationNeedsPermission(false);
            }
        }
    };

    // Update map view in tracking modes (auto and recentre)
    // auto = follows position + rotates with device heading
    // recentre = follows position only, keeps current bearing
    useEffect(() => {
        // Only update if we're in a tracking mode and not being interrupted
        // REMOVED !showRoute constraint to allow updates during navigation
        if (!isUserInteracting.current && !isTransitioning.current && location && (orientationMode === 'auto' || orientationMode === 'recentre')) {
            setViewState(prev => {
                // CRITICAL: Use LIVE zoom from map instance if available.
                // React state (prev.zoom) lags behind native map gestures (pinch).
                // If we force prev.zoom back to the map, we effectively cancel the user's pinch every 60Hz frame.
                const liveZoom = mapRef.current?.getZoom() ?? prev.zoom;

                const newState = {
                    ...prev,
                    longitude: location[1],
                    latitude: location[0],
                    zoom: liveZoom, // Use live zoom
                    pitch: 0
                };
                // Only auto mode rotates with device
                if (orientationMode === 'auto') {
                    // Smooth bearing is already applied to cumulativeRotation
                    newState.bearing = cumulativeRotation;
                    // Apply a small transition (100ms) to hide frame jitter (60Hz -> 100ms smooth)
                    // 0ms was too harsh and revealed react/gpu variance. 300ms was too laggy fighting user.
                    // 100ms is the sweet spot.
                    (newState as any).transitionDuration = 100;
                }
                return newState;
            });
        }
    }, [location, cumulativeRotation, orientationMode, showRoute]);





    // Manage Wake Lock based on orientation mode
    // Manage Wake Lock globally (always active when app is open)
    useEffect(() => {
        requestLock();
        return () => {
            releaseLock();
        };
    }, [requestLock, releaseLock]);

    // Session Persistence
    useEffect(() => {
        const savedSession = localStorage.getItem('parlens_session');
        if (savedSession) {
            try {
                const session = JSON.parse(savedSession);
                if (session.status === 'parked' && session.parkLocation && session.sessionStart) {
                    console.log('[Parlens] Restoring parked session:', session);
                    setSessionStart(session.sessionStart);
                    setParkLocation(session.parkLocation);
                    setStatus('parked');
                } else if (session.status === 'search') {
                    console.log('[Parlens] Restoring search session');
                    setStatus('search');
                }
            } catch (e) {
                console.warn('[Parlens] Failed to restore session:', e);
                localStorage.removeItem('parlens_session');
            }
        }
    }, []);

    // Save session
    useEffect(() => {
        if (status === 'parked' && sessionStart && parkLocation) {
            localStorage.setItem('parlens_session', JSON.stringify({
                status: 'parked',
                sessionStart,
                parkLocation
            }));
        } else if (status === 'search') {
            localStorage.setItem('parlens_session', JSON.stringify({ status: 'search' }));
        } else if (status === 'idle') {
            localStorage.removeItem('parlens_session');
            setSessionStart(null);
        }
    }, [status, sessionStart, parkLocation]);


    // Handle map move - Update state immediately when user moves map
    const handleMove = useCallback((evt: { viewState: typeof viewState }) => {
        setViewState(evt.viewState);

        // Strict Pan-to-Fixed for BOTH Auto and Recentre modes
        // If user is interacting (dragging), immediately switch to 'fixed'.
        // Removed distance buffer as per user request ("if the user pans at all").

        // Interaction Logic:
        // 1. Z O O M: Use multi-touch check (most robust) or isZoomingRef
        //    If >1 touch point, it's a zoom/pitch -> KEEP tracking mode.
        // 2. T H R E S H O L D: Allow small pans in Recentering mode (framing).
        //    Only switch to Fixed if pan is significant (intentional drag away).

        let isZooming = false;

        // Robust Zoom Detection
        if (mapRef.current) {
            // Check ref from event listeners
            if (isZoomingRef.current) isZooming = true;
            // Check active map state
            if (mapRef.current.isZooming()) isZooming = true;
            // Check touch points (if available in original event)
            if (evt && (evt as any).originalEvent && (evt as any).originalEvent.touches && (evt as any).originalEvent.touches.length > 1) {
                isZooming = true;
            }
        }

        if (isUserInteracting.current && (orientationMode === 'auto' || orientationMode === 'recentre')) {
            if (!isZooming) {
                // Calculate pan distance from current location
                // If very small (< 100 meters?), might be accidental or framing.
                // User request: "ensure if the user pans to fix centring in re-centre mdoe it doesn't change back to fixed mode"
                // So we need a threshold.

                let distance = 1.0;
                if (location) {
                    distance = Math.sqrt(
                        Math.pow(evt.viewState.longitude - location[1], 2) +
                        Math.pow(evt.viewState.latitude - location[0], 2)
                    );
                }

                // Threshold: 0.0001 degrees is approx 11 meters.
                // Allow very small jitters, but any real pan switches to Fixed.
                if (distance > 0.0001) {
                    setOrientationMode('fixed');
                }
            }
        }
    }, [location, orientationMode, needsRecenter]);

    const handleMoveStart = useCallback((evt: any) => {
        // Only consider it a USER interaction if caused by input (touch/mouse)
        // Programmatic moves (flyTo, easeTo) do not have originalEvent in some versions, 
        // or we can check specific boolean flags if needed. 
        // MapLibre standard: check if originalEvent exists.
        if (evt.originalEvent) {
            isUserInteracting.current = true;
            // STOP auto-centering animation immediately when user interacts
            // This prevents the "fighting" feeling where the map tries to pull back
            positionAnimator.current.stop();
            // CRITICAL: Stop any ongoing camera animations (flyTo/easeTo) ONLY if we initiated one.
            // If the map is just idle or finishing a previous user fling, calling stop() might break the new gesture.
            if (isTransitioning.current) {
                mapRef.current?.stop();
                isTransitioning.current = false;
            }
        }
    }, []);

    const handleMoveEnd = useCallback(() => {
        // Debounce the interaction end to prevent fighting during multi-touch gestures
        setTimeout(() => {
            isUserInteracting.current = false;
        }, 1000); // 1-second cooldown after user lets go before auto-tracking resumes
        setZoomLevel(viewState.zoom);
    }, [viewState.zoom]);

    // Track Zoom State explicitly (isZooming is unreliable in handleMove)
    const isZoomingRef = useRef(false);
    const handleZoomStart = useCallback(() => {
        isZoomingRef.current = true;
        isUserInteracting.current = true;
        // Stop any ongoing animations to prevents fighting
        positionAnimator.current.stop();
        if (isTransitioning.current) {
            mapRef.current?.stop();
            isTransitioning.current = false;
        }
    }, []);
    const handleZoomEnd = useCallback(() => {
        isZoomingRef.current = false;
        // Debounce the interaction end (same as handleMoveEnd)
        setTimeout(() => {
            if (!isZoomingRef.current) {
                isUserInteracting.current = false;
            }
        }, 1000);
    }, []);

    // Handle map click for drop pin
    const handleClick = useCallback((evt: maplibregl.MapMouseEvent) => {
        if (dropPinMode) {
            setPendingDropPin({ lat: evt.lngLat.lat, lon: evt.lngLat.lng });
        }
    }, [dropPinMode]);

    // Handle vehicle type change
    const handleVehicleChange = (type: 'bicycle' | 'motorcycle' | 'car') => {
        if (status !== 'idle') {
            alert('Please end your current session before changing vehicle type.');
            return;
        }
        setVehicleType(type);
        localStorage.setItem('parlens_vehicle_type', type);
    };

    // Handle route changes from RouteButton
    const handleRouteChange = useCallback((
        main: [number, number][] | null,
        alternate: [number, number][] | null,
        waypoints: { lat: number; lon: number }[] | null,
        showOnMap: boolean
    ) => {
        setRouteCoords(main);
        setAlternateRouteCoords(alternate);
        setRouteWaypoints(waypoints);
        setShowRoute(showOnMap);

        // Fit bounds to route
        if (main && main.length > 1 && mapRef.current && showOnMap) {
            // Combine coordinates from both main and alternate routes for bounds
            const allCoords = [...main];
            if (alternate && alternate.length > 0) {
                allCoords.push(...alternate);
            }

            const lngs = allCoords.map(c => c[1]);
            const lats = allCoords.map(c => c[0]);
            const bounds = new maplibregl.LngLatBounds(
                [Math.min(...lngs), Math.min(...lats)],
                [Math.max(...lngs), Math.max(...lats)]
            );

            // Prevent location tracking from overriding the fit
            isTransitioning.current = true;
            mapRef.current.fitBounds(bounds, { padding: 50, duration: 1000 });
            // Force Fixed Mode so the user can inspect the route without Auto-Centering hijacking the view
            setOrientationMode('fixed');

            // Safety timeout to reset transitioning flag
            setTimeout(() => {
                isTransitioning.current = false;
                // Prompt for toggle if needed to refresh orientation
                if (typeof (DeviceOrientationEvent as any).requestPermission === 'function') {
                    setOrientationNeedsPermission(true);
                }
            }, 1200);
        }
    }, []);

    // Prepare spots for clustering
    const processedHistorySpots = useMemo(() => {
        const filtered = historySpots.filter(spot => {
            const type = spot.decryptedContent?.type || 'car';
            return type === vehicleType;
        });
        return filtered.map(s => {
            const content = s.decryptedContent;
            return content && content.lat && content.lon ? {
                id: s.id,
                lat: content.lat,
                lon: content.lon,
                price: parseFloat(content.fee) || 0,
                currency: content.currency || 'USD',
                original: s
            } : null;
        }).filter(Boolean) as any[];
    }, [historySpots, vehicleType]);

    const clusteredHistorySpots = useMemo(() =>
        clusterSpots(processedHistorySpots, zoomLevel)
        , [processedHistorySpots, zoomLevel]);

    const processedOpenSpots = useMemo(() => {
        if (status !== 'search') return [];
        return openSpots.filter(s => (s.type || 'car') === vehicleType).map(s => ({
            id: s.id,
            lat: s.lat,
            lon: s.lon,
            price: s.price,
            currency: s.currency,
            original: s
        }));
    }, [openSpots, vehicleType, status]);

    const clusteredOpenSpots = useMemo(() =>
        clusterSpots(processedOpenSpots, zoomLevel)
        , [processedOpenSpots, zoomLevel]);

    // Memoize GeoJSON Sources to prevent re-renders


    // Map style based on theme
    const mapStyle = isDarkMode ? MAP_STYLES.dark : MAP_STYLES.light;

    // Route layer configs (inline, no type annotation)
    const routeLayerProps = {
        id: 'route',
        type: 'line' as const,
        paint: {
            'line-color': '#007AFF',
            'line-width': 5,
            'line-opacity': 0.9
        }
    };

    const alternateRouteLayerProps = {
        id: 'alternate-route',
        type: 'line' as const,
        paint: {
            'line-color': '#007AFF',
            'line-width': 3,
            'line-opacity': 0.4,
            'line-dasharray': [2, 2]
        }
    };



    return (
        <div className="fixed inset-0 overflow-hidden bg-gray-50 dark:bg-black transition-colors duration-300">
            {/* Loading Overlay - Covers everything until ready */}
            {((!location && !locationError) || !isMapLoaded) && (
                <div className="absolute inset-0 z-[2000] flex items-center justify-center bg-gray-50 dark:bg-black transition-opacity duration-500">
                    <div className="flex flex-col items-center gap-4 animate-in fade-in duration-700 px-8 max-w-sm text-center">
                        {!locationError ? (
                            <>
                                <div className="w-8 h-8 rounded-full border-4 border-blue-500/20 border-t-blue-500 animate-spin" />
                                <p className="text-sm font-semibold text-zinc-400 dark:text-white/40 tracking-tight">Locating...</p>
                            </>
                        ) : (
                            <>
                                <div className="w-12 h-12 rounded-full bg-red-500/20 flex items-center justify-center">
                                    <span className="text-2xl">📍</span>
                                </div>
                                <p className="text-sm font-medium text-red-500 dark:text-red-400">{locationError}</p>
                                <button
                                    onClick={() => window.location.reload()}
                                    className="mt-2 px-6 py-2 rounded-full bg-blue-500 text-white text-sm font-medium active:scale-95 transition-transform"
                                >
                                    Try Again
                                </button>
                            </>
                        )}
                    </div>
                </div>
            )}
            {/* Drop Pin Mode Indicator */}
            {dropPinMode && (
                <div className="absolute top-0 left-0 right-0 z-[1000] bg-orange-500 text-white py-3 px-4 text-center font-medium shadow-lg animate-pulse">
                    📍 Tap anywhere on the map to drop a pin
                </div>
            )}

            {/* Active Session Indicator (Parked Mode) - Green Pill Top Center */}
            {status === 'parked' && (
                <div className="absolute top-6 left-1/2 -translate-x-1/2 z-[1000] h-12 px-6 bg-[#34C759] rounded-full shadow-lg flex items-center gap-3 animate-in slide-in-from-top-4 pointer-events-none">
                    <div className="text-xl">
                        {vehicleType === 'bicycle' ? '🚲' : vehicleType === 'motorcycle' ? '🏍️' : '🚗'}
                    </div>
                    <span className="font-bold text-white whitespace-nowrap">Session Active</span>
                </div>
            )}

            {/* Searching Bubble (Search Mode) - White Pill with Orange Dot */}
            {status === 'search' && (
                <div className="absolute top-6 left-1/2 -translate-x-1/2 z-[1000] h-12 px-6 bg-white dark:bg-zinc-800 rounded-full shadow-lg flex items-center gap-3 animate-in slide-in-from-top-4 pointer-events-none">
                    <div className="w-2.5 h-2.5 rounded-full bg-[#FF9500] animate-pulse" />
                    <span className="font-bold text-zinc-900 dark:text-white whitespace-nowrap">Searching for spots</span>
                </div>
            )}

            {/* STATIC USER MARKER (Auto Mode Only) - Eliminates Vibration & Shaking */}
            {orientationMode === 'auto' && location && (
                <div
                    className="absolute top-1/2 left-1/2 z-[900] pointer-events-none flex items-center justify-center"
                    style={{
                        transform: 'translate(-50%, -50%)', // Robust centering
                        width: '40px', // Explicit size to prevent layout collapse/skew
                        height: '40px'
                    }}
                >
                    <UserLocationMarker
                        bearing={userHeading}
                        mapBearing={viewState.bearing}
                        isNavigationMode={true}
                    />
                </div>
            )
            }

            {/* MapLibre GL Map */}
            <div
                className="absolute inset-0"
                // CAPTURE ALL TOUCHES/CLICKS EARLY
                // This guarantees we mark interaction BEFORE MapLibre or React updates processing
                onPointerDownCapture={() => {
                    isUserInteracting.current = true;
                    positionAnimator.current.stop();
                    if (isTransitioning.current) {
                        mapRef.current?.stop();
                        isTransitioning.current = false;
                    }
                }}
                // CAPTURE TOUCH GESTURES (Multi-touch Zoom/Rotate)
                onTouchStartCapture={() => {
                    isUserInteracting.current = true;
                    positionAnimator.current.stop();
                    if (isTransitioning.current) {
                        mapRef.current?.stop();
                        isTransitioning.current = false;
                    }
                }}
                // CAPTURE WHEEL/TRACKPAD ZOOM EARLY
                onWheelCapture={() => {
                    isUserInteracting.current = true;
                    if (isTransitioning.current) {
                        mapRef.current?.stop();
                        isTransitioning.current = false;
                    }
                    if ((window as any).wheelDebounce) clearTimeout((window as any).wheelDebounce);
                    (window as any).wheelDebounce = setTimeout(() => {
                        isUserInteracting.current = false;
                    }, 1000);
                }}
                // Ensure browser doesn't hijack gestures (e.g. pull-to-refresh)
                style={{ touchAction: 'none' }}
            >


                <Map
                    ref={mapRef}
                    {...viewState}
                    onLoad={(e) => {
                        setIsMapLoaded(true);
                        const map = e.target;
                        if (map) {


                            // Dark Mode Filter
                            const layers = map.getStyle().layers;
                            layers?.forEach(layer => {
                                if (layer.id.includes('oneway') || layer.id.includes('arrow') || layer.id.includes('direction')) {
                                    map.setLayoutProperty(layer.id, 'visibility', 'none');
                                }
                            });
                        }
                    }}
                    onMove={handleMove}
                    onMoveStart={handleMoveStart}
                    onMoveEnd={handleMoveEnd}
                    onZoomStart={handleZoomStart}
                    onZoomEnd={handleZoomEnd}
                    onRotateStart={() => { isUserInteracting.current = true; positionAnimator.current.stop(); }}
                    onRotateEnd={handleMoveEnd} // Reuse debounce logic
                    onPitchStart={() => { isUserInteracting.current = true; positionAnimator.current.stop(); }}
                    onPitchEnd={handleMoveEnd} // Reuse debounce logic
                    onClick={(e) => {
                        // Handle empty map click
                        // DOM Markers handle their own clicks via onClick prop
                        handleClick(e);
                    }}
                    style={{ width: '100%', height: '100%' }}
                    mapStyle={mapStyle}
                    attributionControl={false}
                    dragPan={!isTransitioning.current}
                    // Fix for "Map breaks on zoom out" - Restrict zoom and ensure copies
                    minZoom={3} // Prevents zooming out too far (perf killer)
                    maxZoom={20}
                    renderWorldCopies={true}
                >
                    {/* Routes */}
                    {showRoute && alternateRouteCoords && alternateRouteCoords.length > 1 && (
                        <Source
                            id="alternate-route"
                            type="geojson"
                            data={{
                                type: 'Feature',
                                properties: {},
                                geometry: {
                                    type: 'LineString',
                                    coordinates: alternateRouteCoords.map(c => [c[1], c[0]])
                                }
                            }}
                        >
                            <Layer {...alternateRouteLayerProps} />
                        </Source>
                    )}

                    {showRoute && routeCoords && routeCoords.length > 1 && (
                        <Source
                            id="route"
                            type="geojson"
                            data={{
                                type: 'Feature',
                                properties: {},
                                geometry: {
                                    type: 'LineString',
                                    coordinates: routeCoords.map(c => [c[1], c[0]])
                                }
                            }}
                        >
                            <Layer {...routeLayerProps} />
                        </Source>
                    )}

                    {/* Open Spots Markers */}
                    {status === 'search' && clusteredOpenSpots.map(item => {
                        const isClusterItem = isCluster(item);
                        return (
                            <Marker
                                key={`open-${item.id}`}
                                longitude={item.lon}
                                latitude={item.lat}
                                anchor="center"
                                style={{ willChange: 'transform' }} // Stabilization
                                onClick={(e) => {
                                    e.originalEvent.stopPropagation();
                                    if (isClusterItem) {
                                        mapRef.current?.flyTo({ center: [item.lon, item.lat], zoom: viewState.zoom + 2 });
                                    } else {
                                        handleClick({
                                            lngLat: { lng: item.lon, lat: item.lat }
                                        } as any);
                                    }
                                }}
                            >
                                {isClusterItem ? (
                                    <ClusterMarkerContent
                                        count={item.count}
                                        minPrice={item.minPrice}
                                        maxPrice={item.maxPrice}
                                        currency={item.currency}
                                        type="open"
                                    />
                                ) : (
                                    <SpotMarkerContent
                                        price={item.price}
                                        currency={item.currency}
                                        emoji="🅿️"
                                    />
                                )}
                            </Marker>
                        );
                    })}

                    {/* History Spots Markers */}
                    {clusteredHistorySpots.map(item => {
                        const isClusterItem = isCluster(item);
                        return (
                            <Marker
                                key={`history-${item.id}`}
                                longitude={item.lon}
                                latitude={item.lat}
                                anchor="center"
                                style={{ willChange: 'transform' }}
                                onClick={(e) => {
                                    e.originalEvent.stopPropagation();
                                    if (isClusterItem) {
                                        mapRef.current?.flyTo({ center: [item.lon, item.lat], zoom: viewState.zoom + 2 });
                                    }
                                }}
                            >
                                {isClusterItem ? (
                                    <ClusterMarkerContent
                                        count={item.count}
                                        minPrice={item.minPrice}
                                        maxPrice={item.maxPrice}
                                        currency={item.currency}
                                        type="history"
                                    />
                                ) : (
                                    <SpotMarkerContent
                                        price={item.price}
                                        currency={item.currency}
                                        emoji="🅟"
                                        isHistory={true}
                                    />
                                )}
                            </Marker>
                        );
                    })}

                    {/* Route waypoints */}
                    {showRoute && routeWaypoints?.map((wp, index) => (
                        <Marker
                            key={`waypoint-${index}`}
                            longitude={wp.lon}
                            latitude={wp.lat}
                            anchor="center"
                        >
                            <div style={{
                                width: 20,
                                height: 20,
                                background: '#007AFF',
                                border: '2px solid white',
                                borderRadius: '50%',
                                boxShadow: '0 2px 6px rgba(0,0,0,0.3)',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                color: 'white',
                                fontSize: 10,
                                fontWeight: 'bold'
                            }}>
                                {index + 1}
                            </div>
                        </Marker>
                    ))}

                    {/* Parked Vehicle Marker */}
                    {status === 'parked' && parkLocation && (
                        <Marker
                            longitude={parkLocation[1]}
                            latitude={parkLocation[0]}
                            anchor="center"
                        >
                            <ActiveSessionMarkerContent vehicleType={vehicleType} />
                        </Marker>
                    )}

                    {/* User location marker - Unified for ALL modes for smooth transitions */}
                    {location && orientationMode !== 'auto' && (
                        <Marker
                            longitude={location[1]}
                            latitude={location[0]}
                            anchor="center"
                            style={{ zIndex: 1000 }}
                        >
                            <UserLocationMarker
                                bearing={userHeading}
                                mapBearing={viewState.bearing}
                                isNavigationMode={false}
                            />
                        </Marker>
                    )}
                </Map>
            </div>




            {/* Bottom Left Controls */}
            <div className="absolute z-[1000] flex flex-col items-start gap-3 animate-in slide-in-from-left-6" style={{
                bottom: 'max(1.5rem, calc(env(safe-area-inset-bottom) + 0.5rem))',
                left: 'max(1rem, env(safe-area-inset-left))'
            }}>
                {/* Vehicle Toggle - Collapsible */}
                <VehicleToggle
                    vehicleType={vehicleType}
                    onVehicleChange={handleVehicleChange}
                    disabled={status !== 'idle'}
                />

                {/* Help Button */}
                <button
                    onClick={() => setShowHelp(true)}
                    className="h-12 w-12 flex items-center justify-center rounded-[1.5rem] bg-white/80 dark:bg-zinc-800/80 backdrop-blur-md border border-black/5 dark:border-white/10 shadow-lg text-zinc-600 dark:text-white/70 transition-all active:scale-95"
                >
                    <HelpCircle size={20} />
                </button>
            </div>

            {/* Bottom Right Controls */}
            <div className="absolute z-[1000] flex flex-col items-end gap-3 animate-in slide-in-from-right-6" style={{
                bottom: 'max(1.5rem, calc(env(safe-area-inset-bottom) + 0.5rem))',
                right: 'max(1rem, env(safe-area-inset-right))'
            }}>


                {/* Compass - show when map is rotated (matches other button styles) */}
                {Math.abs(viewState.bearing) > 5 && orientationMode !== 'auto' && (
                    <button
                        onClick={() => {
                            mapRef.current?.rotateTo(0, { duration: 400 });
                            setViewState(prev => ({ ...prev, bearing: 0, pitch: 0 }));
                        }}
                        className="h-12 w-12 flex items-center justify-center rounded-[1.5rem] backdrop-blur-md transition-all active:scale-95 border shadow-lg bg-white/80 dark:bg-zinc-800/80 border-black/5 dark:border-white/10"
                        title="Reset to true north"
                    >
                        <div
                            className="flex flex-col items-center justify-center"
                            style={{ transform: `rotate(${-viewState.bearing}deg)` }}
                        >
                            <div style={{
                                width: 0,
                                height: 0,
                                borderLeft: '6px solid transparent',
                                borderRight: '6px solid transparent',
                                borderBottom: '10px solid rgb(239 68 68)'
                            }} />
                            <span className="text-sm font-bold text-zinc-600 dark:text-white/70" style={{ marginTop: '-2px' }}>N</span>
                        </div>
                    </button>
                )}

                {/* Orientation Toggle */}
                <button
                    onClick={async () => {
                        if (orientationNeedsPermission) {
                            await requestOrientationPermission();
                            return;
                        }

                        // CRITICAL: Stop any ongoing map animations (e.g. flyTo) immediately
                        // This ensures the button works even if the map is currently moving/animating
                        mapRef.current?.stop();
                        isTransitioning.current = false; // Reset transition flag just in case

                        // Logic:
                        // 1. If map is not centered on user (needsRecenter):
                        //    - Recenter ONLY (keep zoom if > 17).
                        //    - If Zoom < 17, also zoom to 17.
                        // 2. If map IS centered (needsRecenter = false):
                        //    - If Zoom != 17 (specifically > 17 per requirement):
                        //      "If the user is zoomed in beyond the default level... next time they click it we will fix it to the default level."
                        //      "If the user is zoomed out... first click first recentres... then we zoom in."

                        const currentZoom = viewState.zoom;
                        const DEFAULT_ZOOM = 17;

                        // Case 1: Needs Recenter (User panned away)
                        if (needsRecenter) {
                            if (location) {
                                // If zoomed out, zoom in. If zoomed in, keep zoom.
                                const targetZoom = currentZoom < DEFAULT_ZOOM ? DEFAULT_ZOOM : currentZoom;

                                isTransitioning.current = true;
                                mapRef.current?.flyTo({
                                    center: [location[1], location[0]],
                                    zoom: targetZoom,
                                    duration: 800,
                                    essential: true
                                });
                                mapRef.current?.once('moveend', () => { isTransitioning.current = false; });
                            }
                            setOrientationMode('recentre');
                            setNeedsRecenter(false);
                            return;
                        }

                        // Case 2: Already Centered but Incorrect Zoom OR Manual Re-trigger
                        // If we are already in 'recentre' or 'fixed' and coming back, make it smooth.
                        if (orientationMode === 'fixed' || orientationMode === 'recentre') {
                            if (location) {
                                isTransitioning.current = true;
                                mapRef.current?.flyTo({
                                    center: [location[1], location[0]], // Ensure we fly to user
                                    zoom: currentZoom < DEFAULT_ZOOM ? DEFAULT_ZOOM : currentZoom,
                                    bearing: 0, // Reset bearing for recentre mode
                                    duration: 800,
                                    essential: true
                                });
                                mapRef.current?.once('moveend', () => {
                                    isTransitioning.current = false;
                                    // Ensure we stay in recentre mode after flyTo (fixes any pending state)
                                    if (orientationMode === 'fixed') setOrientationMode('recentre');
                                });
                            }
                        }

                        // Case 3: Cycle Modes
                        // Standard mobile map pattern:
                        // Fixed (Off) -> Recentre (Follow) -> Auto (Heading) -> Recentre (Follow)
                        // Pan -> Fixed (Handled in handleMove)

                        if (orientationMode === 'recentre') {
                            // If PARKED, skip Auto mode and go back to Fixed
                            if (status === 'parked') {
                                isTransitioning.current = true;
                                mapRef.current?.flyTo({
                                    bearing: 0,
                                    pitch: 0,
                                    zoom: 16.5,
                                    duration: 800,
                                    essential: true
                                });
                                mapRef.current?.once('moveend', () => { isTransitioning.current = false; });
                                setOrientationMode('fixed');
                                return;
                            }

                            // Normal behavior: Recentre -> Auto
                            // Smoothly rotate map to current compass heading BEFORE switching mode
                            // This prevents the "snap" from 0 to current heading
                            const targetBearing = userHeading || 0;
                            isTransitioning.current = true;
                            setPendingAutoMode(true); // Immediate visual update
                            mapRef.current?.rotateTo(targetBearing, { duration: 800 });
                            mapRef.current?.once('moveend', () => {
                                isTransitioning.current = false;
                                setPendingAutoMode(false);
                                // Reset animator to match target to prevent spin on takeover
                                bearingAnimator.current.reset(targetBearing);
                                setOrientationMode('auto');
                            });
                            return; // Don't change mode yet
                        }

                        setOrientationMode(m => {
                            if (m === 'auto') {
                                // NEW: Auto -> Fixed (Exit Cycle)
                                // Reset zoom to default (16.5) and rotation to 0
                                isTransitioning.current = true;
                                mapRef.current?.flyTo({
                                    bearing: 0,
                                    pitch: 0,
                                    zoom: 16.5,
                                    duration: 800,
                                    essential: true
                                });
                                // Reset flags
                                mapRef.current?.once('moveend', () => { isTransitioning.current = false; });
                                setPendingAutoMode(false);
                                return 'fixed'; // Switch to Fixed
                            }
                            // Fixed -> Recentre (Cycle started by flyTo above)
                            return 'recentre';
                        });
                    }}
                    className={`h-12 w-12 flex items-center justify-center rounded-[1.5rem] backdrop-blur-md transition-all active:scale-95 border shadow-lg ${orientationNeedsPermission
                        ? 'bg-orange-500/20 border-orange-500/50 text-orange-500 animate-pulse'
                        : 'bg-white/80 dark:bg-zinc-800/80 border-black/5 dark:border-white/10 text-zinc-600 dark:text-white/70'
                        }`}
                >
                    {orientationNeedsPermission ? (
                        <MapPin size={20} />
                    ) : (orientationMode === 'auto' || pendingAutoMode) ? (
                        <ArrowUp size={20} className="text-blue-500" />
                    ) : orientationMode === 'recentre' ? (
                        <Locate size={20} fill="currentColor" className="text-green-500" />
                    ) : (
                        <MapPin size={20} />
                    )}
                </button>

                {/* Route Button */}
                <RouteButton
                    vehicleType={vehicleType}
                    onRouteChange={handleRouteChange}
                    currentLocation={location}
                    onDropPinModeChange={setDropPinMode}
                    pendingDropPin={pendingDropPin}
                    onDropPinConsumed={() => setPendingDropPin(null)}
                />

                {/* Profile Button - Moved back here */}
                <div className="relative z-[1010]">
                    <ProfileButton
                        setHistorySpots={setHistorySpots}
                    />
                </div>

                {/* FAB */}
                {/* Ensure we pass a valid location tuple if available, or default to 0,0 (FAB won't search if null anyway) */}

                <FAB
                    status={status}
                    setStatus={setStatus}
                    searchLocation={location} // Pass null if location not ready
                    vehicleType={vehicleType}
                    setOpenSpots={setOpenSpots}
                    parkLocation={parkLocation}
                    setParkLocation={setParkLocation}
                    sessionStart={sessionStart}
                    setSessionStart={setSessionStart}
                />
            </div>



            {/* Help Modal */}
            {
                showHelp && (
                    <div className="fixed inset-0 z-[2000] flex flex-col items-center justify-start bg-black/60 backdrop-blur-xl pt-2 px-4 pb-4 animate-in fade-in">
                        <button
                            onClick={() => setShowHelp(false)}
                            className="absolute inset-0 z-0 cursor-default"
                        />
                        <div
                            className="relative z-10 w-full max-w-md bg-white dark:bg-[#1c1c1e] rounded-[2rem] border border-black/5 dark:border-white/5 shadow-2xl p-6 space-y-6 animate-in slide-in-from-bottom-10 duration-300 h-[calc(100vh-1.5rem)] overflow-y-auto no-scrollbar transition-colors"
                            style={{ overscrollBehaviorY: 'contain' }}
                        >
                            <button
                                onClick={() => setShowHelp(false)}
                                className="absolute top-6 right-6 p-2 rounded-full bg-black/5 dark:bg-white/10 transition-colors"
                            >
                                <X size={20} className="text-black/60 dark:text-white/60" />
                            </button>

                            <div className="text-center space-y-2 pt-4">
                                <div className="mx-auto w-16 h-16 rounded-full bg-blue-500/20 flex items-center justify-center text-blue-500 dark:text-blue-400 mb-4">
                                    <HelpCircle size={32} />
                                </div>
                                <h2 className="text-2xl font-bold text-zinc-900 dark:text-white">How to use Parlens</h2>
                                <p className="text-sm text-zinc-500 dark:text-zinc-400">Decentralized Route & Parking Management</p>
                            </div>



                            {/* Install Instructions Accordion */}
                            <div className="space-y-3">
                                <h3 className="text-center font-bold text-zinc-600 dark:text-white/90">Add to your homescreen</h3>
                                {/* Android */}
                                <div className="rounded-2xl bg-zinc-100 dark:bg-white/5">
                                    <button onClick={() => {
                                        const el = document.getElementById('android-guide');
                                        el?.classList.toggle('hidden');
                                    }} className="w-full flex items-center justify-between p-4 font-bold text-sm text-left text-zinc-800 dark:text-zinc-200 transition-colors rounded-2xl" style={{ WebkitTapHighlightColor: 'transparent' }}>
                                        <span>Using Browser Menu (Android)</span>
                                        <ChevronDown size={16} className="text-zinc-400 dark:text-white/50" />
                                    </button>
                                    <div id="android-guide" className="hidden p-4 pt-0 text-xs text-zinc-600 dark:text-white/70 space-y-2">
                                        <p className="font-semibold text-zinc-900 dark:text-white">Chrome & Brave:</p>
                                        <ol className="list-decimal pl-5 space-y-1">
                                            <li>Tap menu button (three dots)</li>
                                            <li>Tap <strong>Add to Home screen</strong></li>
                                            <li>Tap <strong>Add</strong> to confirm</li>
                                        </ol>
                                        <p className="font-semibold text-zinc-900 dark:text-white mt-3">Firefox:</p>
                                        <ol className="list-decimal pl-5 space-y-1">
                                            <li>Tap menu button (three dots)</li>
                                            <li>Tap <strong>Install</strong></li>
                                        </ol>
                                    </div>
                                </div>

                                {/* iOS */}
                                <div className="rounded-2xl bg-zinc-100 dark:bg-white/5">
                                    <button onClick={() => {
                                        const el = document.getElementById('ios-guide');
                                        el?.classList.toggle('hidden');
                                    }} className="w-full flex items-center justify-between p-4 font-bold text-sm text-left text-zinc-800 dark:text-zinc-200 transition-colors rounded-2xl" style={{ WebkitTapHighlightColor: 'transparent' }}>
                                        <span>Using Share Button (iOS)</span>
                                        <ChevronDown size={16} className="text-zinc-400 dark:text-white/50" />
                                    </button>
                                    <div id="ios-guide" className="hidden p-4 pt-0 text-xs text-zinc-600 dark:text-white/70 space-y-2">
                                        <ol className="list-decimal pl-5 space-y-1">
                                            <li>Tap the <strong>Share</strong> button in Safari menu bar.</li>
                                            <li>Scroll down and tap <strong>Add to Home Screen</strong>.</li>
                                            <li>Launch Parlens from your home screen.</li>
                                        </ol>
                                    </div>
                                </div>
                            </div>

                            <div className="space-y-6 text-sm text-zinc-600 dark:text-white/80 leading-relaxed pt-4 border-t border-black/5 dark:border-white/10">
                                <p>
                                    <strong className="text-zinc-900 dark:text-white block mb-1">1. Select vehicle type</strong>
                                    Use the vertical toggle on the bottom-left to switch between Bicycle 🚲, Motorcycle 🏍️, or Car 🚗.
                                </p>

                                <p>
                                    <strong className="text-zinc-900 dark:text-white block mb-1">2. Plan your route (optional)</strong>
                                    Tap the route button to add waypoints and create a route. If the system generated route(s) between your start and end points are not to your liking, add additional waypoints in locations you would prefer travelling through. Click the location button to re-centre and turn on follow-me or navigation mode for route tracking.
                                </p>

                                <p>
                                    <strong className="text-zinc-900 dark:text-white block mb-1">3. Find and log parking</strong>
                                    Click the main button once to see open spots reported by others live or within the last 5 minutes. Click again to mark your location. When leaving, click once more to end the session and report the fee. Use the profile button to see your parking history.
                                </p>

                                <p>
                                    <strong className="text-zinc-900 dark:text-white block mb-1">4. Create your own mirror (optional)</strong>
                                    <a
                                        href="https://github.com/prasannawarrier/parlens-pwa/blob/main/MIRROR_CREATION.md"
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-blue-500 dark:text-blue-400 underline"
                                    >
                                        Follow these steps
                                    </a> to create your own mirror of the Parlens app to distribute the bandwidth load while sharing with your friends.
                                </p>

                                <p>
                                    <strong className="text-zinc-900 dark:text-white block mb-1">5. User privacy</strong>
                                    Parlens does not collect or share any user data. Your log and route data is encrypted by your keys and only accessible by you. Open spot broadcasts are ephemeral and not linked to any personal identifiers.
                                </p>

                                {/* Bottom tip */}
                                <div className="p-3 rounded-xl bg-amber-500/10 dark:bg-amber-500/5 border border-amber-500/20 mt-6">
                                    <p className="text-xs text-amber-700 dark:text-amber-400/80 leading-relaxed">
                                        <span className="font-bold">Tip: </span>
                                        Use Parlens over your cellular internet connection to prevent personal IP address(es) from being associated with your data.
                                    </p>
                                </div>
                            </div>
                        </div>
                    </div>
                )
            }
        </div >
    );
};

export default LandingPage;
