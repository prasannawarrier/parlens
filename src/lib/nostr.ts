export const KINDS = {
    PARKING_LOG: 31417, // My Parking Log (Parameterized Replaceable for history)
    PARKING_AREA_INDICATOR: 31714, // Parking Area Indicator (Addressable/Replaceable with expiration)
    ROUTE_LOG: 34171, // My Route Log (Addressable for saved routes)
    RELAY_LIST: 10002, // NIP-65 Relay List Metadata (Replaceable)
    // Listed Parking Kinds
    LISTED_PARKING_METADATA: 31147, // Listed Parking Metadata (Parent - Addressable)
    PARKING_SPOT_LISTING: 37141, // Parking Spot Listing (Child - Addressable)
    LISTED_SPOT_LOG: 1714, // Listed Spot Log Update (Status - Regular)
    PRIVATE_LOG_NOTE: 1417, // Private Log Status Note (Encrypted - Regular)
    LABEL: 1985, // NIP-32 Label for approvals
};

// Approver pubkey for public listing approval workflow
export const APPROVER_PUBKEY = 'f8ecf5df652f567970ec6d00538cc15c4cec9d0c88760cd8b4c86acd43542e5a';

export const DEFAULT_RELAYS = [
    'wss://relay.primal.net',
    'wss://nos.lol',
    'wss://relay.snort.social',
];

/**
 * Kind 31417 - Parking Log (Private History)
 * 
 * Public Tags (only non-sensitive):
 *   ['d', 'session_<timestamp>']  - Required for parameterized replaceable
 *   ['client', 'parlens']
 * 
 * Content (NIP-44 Encrypted):
 *   - All sensitive data including location, type, and geohash
 */
export interface ParkingLogContent {
    status?: 'parked' | 'vacated'; // Encrypted for privacy
    type?: 'bicycle' | 'motorcycle' | 'car'; // Encrypted for privacy (NOT in public tags!)
    location?: string; // For listed: Listing Name; For regular: "lat, lng"
    lat?: number; // Latitude (encrypted)
    lon?: number; // Longitude (encrypted)
    g?: string; // Legacy: 10-digit geohash
    geohash?: string; // 10-digit geohash (encrypted, NOT in public tags!)
    start?: number; // Legacy: timestamp
    started_at?: number; // Start timestamp
    end?: number; // Legacy: timestamp
    finished_at?: number; // End timestamp
    fee?: string; // e.g., "10"
    currency?: string; // e.g., "USD"
    note?: string; // User-added note for this parking entry
    // Listed Parking Fields (encrypted)
    spotATag?: string; // Reference to spot (37141:pubkey:d)
    listingATag?: string; // Reference to parent listing (31147:pubkey:d)
    listingName?: string;
    floor?: string;
    spotNumber?: string;
    shortName?: string;
}

// Waypoint for route storage
export interface RouteWaypoint {
    name: string;
    lat: number;
    lon: number;
}

/**
 * Kind 34171 - Route Log (Private Saved Routes)
 * 
 * Public Tags:
 *   ['d', 'route_<timestamp>']
 *   ['client', 'parlens']
 * 
 * Content (NIP-44 Encrypted):
 *   - All route data including waypoints and coordinates
 */
export interface RouteLogContent {
    name: string; // User-provided route name
    waypoints: RouteWaypoint[]; // Array of waypoints
    routeCoords: [number, number][]; // Primary route coordinates
    alternateRouteCoords?: [number, number][]; // Optional alternate route
    vehicleType: 'bicycle' | 'motorcycle' | 'car';
    created_at: number; // Unix timestamp
}

/**
 * Kind 31714 - Parking Area Indicator (Public - Anonymous)
 * 
 * Public Tags (all data is public, but published with anonymous keypair):
 *   ['d', 'spot_<geohash>_<timestamp>']
 *   ['g', '<geohash>']           - For geo-discovery
 *   ['location', '<lat>,<lon>']
 *   ['hourly_rate', '<price>']
 *   ['currency', '<code>']
 *   ['type', 'bicycle|motorcycle|car']
 *   ['expiration', '<timestamp>']
 *   ['client', 'parlens']
 * 
 * Content: '' (empty - all data in tags for public discovery)
 */
export interface BroadcastTags {
    location: string;
    g: string;
    client: string;
    type: 'car' | 'motorcycle' | 'bicycle';
}
