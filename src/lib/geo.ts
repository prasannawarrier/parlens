/**
 * Encodes a lat/lng pair into a 10-digit geohash.
 * Simple implementation for the purpose of the prototype.
 */
export function encodeGeohash(lat: number, lng: number, precision: number = 10): string {
    const BITS = [16, 8, 4, 2, 1];
    const BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';

    let isEven = true;
    let latMin = -90, latMax = 90;
    let lngMin = -180, lngMax = 180;
    let geohash = '';
    let bit = 0;
    let ch = 0;

    while (geohash.length < precision) {
        if (isEven) {
            const mid = (lngMin + lngMax) / 2;
            if (lng > mid) {
                ch |= BITS[bit];
                lngMin = mid;
            } else {
                lngMax = mid;
            }
        } else {
            const mid = (latMin + latMax) / 2;
            if (lat > mid) {
                ch |= BITS[bit];
                latMin = mid;
            } else {
                latMax = mid;
            }
        }

        isEven = !isEven;
        if (bit < 4) {
            bit++;
        } else {
            geohash += BASE32[ch];
            bit = 0;
            ch = 0;
        }
    }
    return geohash;
}

/**
 * Formats coordinates to 6 decimal places.
 */
export function formatCoords(lat: number, lng: number): string {
    return `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
}

/**
 * Gets the neighboring geohashes (including center) for boundary-safe searching.
 * Returns an array of 9 geohashes: center + 8 neighbors.
 */
export function getGeohashNeighbors(lat: number, lng: number, precision: number = 5): string[] {
    const center = encodeGeohash(lat, lng, precision);

    // Approximate offset for a geohash cell at given precision
    // These are rough estimates that work well enough for our use case
    const latOffset = precision === 4 ? 0.17 : precision === 5 ? 0.02 : precision === 6 ? 0.005 : 0.001;
    const lngOffset = precision === 4 ? 0.35 : precision === 5 ? 0.04 : precision === 6 ? 0.01 : 0.002;

    const neighbors = new Set<string>();
    neighbors.add(center);

    // Add 8 neighbors by offsetting lat/lng
    const offsets = [
        [-1, -1], [-1, 0], [-1, 1],
        [0, -1], [0, 1],
        [1, -1], [1, 0], [1, 1]
    ];

    for (const [latMult, lngMult] of offsets) {
        const neighborLat = lat + (latMult * latOffset);
        const neighborLng = lng + (lngMult * lngOffset);
        neighbors.add(encodeGeohash(neighborLat, neighborLng, precision));
    }

    return Array.from(neighbors);
}

/**
 * Converts a geohash to its bounding box (SW and NE corners).
 * Returns { sw: [lat, lon], ne: [lat, lon] }
 */
export function geohashToBounds(geohash: string): { sw: [number, number], ne: [number, number] } {
    const BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';

    let isEven = true;
    let latMin = -90, latMax = 90;
    let lngMin = -180, lngMax = 180;

    for (const char of geohash.toLowerCase()) {
        const idx = BASE32.indexOf(char);
        if (idx === -1) continue;

        for (let i = 0; i < 5; i++) {
            const bit = (idx >> (4 - i)) & 1;
            if (isEven) {
                const mid = (lngMin + lngMax) / 2;
                if (bit) {
                    lngMin = mid;
                } else {
                    lngMax = mid;
                }
            } else {
                const mid = (latMin + latMax) / 2;
                if (bit) {
                    latMin = mid;
                } else {
                    latMax = mid;
                }
            }
            isEven = !isEven;
        }
    }

    return {
        sw: [latMin, lngMin],
        ne: [latMax, lngMax]
    };
}

/**
 * Parses a string input to attempt to find a coordinate.
 * Supports:
 * - Decimal coordinates (lat, lon) or (lat lon)
 * - Google Plus Codes (Open Location Code)
 */
import OpenLocationCode from 'open-location-code';

// The library exports OpenLocationCode as a class constructor
const OLCLib = OpenLocationCode as any;
const OLCClass = OLCLib.OpenLocationCode || OLCLib.default?.OpenLocationCode || OLCLib;
const OLC = new OLCClass();

export function recoverPlusCode(code: string, lat: number, lon: number): { lat: number, lon: number, type: 'plus_code' } | null {
    try {
        // Try to recover the short code using the reference location
        // Don't check isValid first - it may fail for short codes but recoverNearest can still work
        if (OLC && OLC.recoverNearest) {

            const recovered = OLC.recoverNearest(code, lat, lon);

            const decoded = OLC.decode(recovered);

            return { lat: decoded.latitudeCenter, lon: decoded.longitudeCenter, type: 'plus_code' };
        }
    } catch (e) {
        console.error('[Parlens] Plus Code recovery failed:', e);
    }
    return null;
}

export function parseCoordinate(input: string): { lat: number, lon: number, type: 'coordinate' | 'plus_code' } | null {
    const trimmed = input.trim();

    // 1. Try Decimal Degrees with Directions: "13.00° N, 77.66° E" or "-12.34, 56.78"
    // Clean up input by removing degree symbols
    const cleanInput = trimmed.replace(/°/g, '').replace(/,/g, ' ');

    // Split by whitespace to find parts
    const parts = cleanInput.split(/\s+/).filter(p => p.length > 0);

    // If we have 2 numbers (standard decimal) or 2 numbers + directions
    if (parts.length >= 2) {
        let lat: number | null = null;
        let lon: number | null = null;

        // Pattern A: Classic "Lat, Lon" (numbers only, handled by simple parse)
        const simpleMatch = trimmed.match(/^(-?\d+(\.\d+)?)[,\s]+(-?\d+(\.\d+)?)$/);
        if (simpleMatch) {
            lat = parseFloat(simpleMatch[1]);
            lon = parseFloat(simpleMatch[3]);
        }
        // Pattern B: "13.0 N 77.6 E" style parsing
        else {
            // Try to find two numbers and optional direction letters
            // Regex to grab number + optional letter
            const coordMatches = trimmed.matchAll(/([0-9.-]+)\s*°?\s*([NSEWnsew])?/g);
            const found = Array.from(coordMatches);

            if (found.length === 2) {
                const val1 = parseFloat(found[0][1]);
                const dir1 = found[0][2]?.toUpperCase();
                const val2 = parseFloat(found[1][1]);
                const dir2 = found[1][2]?.toUpperCase();

                // Helper to assign based on dir
                const assign = (val: number, dir?: string) => {
                    let signed = val;
                    if (dir === 'S' || dir === 'W') signed = -val;

                    if (dir === 'N' || dir === 'S') return { type: 'lat', val: signed };
                    if (dir === 'E' || dir === 'W') return { type: 'lon', val: signed };
                    return { type: 'unknown', val: signed }; // Assume order if unknown?
                };

                // Logic: 
                // If directions are present, use them.
                // If one is Lat and one is Lon, great.
                // Common format: Lat then Lon.

                const p1 = assign(val1, dir1);
                const p2 = assign(val2, dir2);

                if (p1.type === 'lat' && p2.type === 'lon') { lat = p1.val; lon = p2.val; }
                else if (p1.type === 'lon' && p2.type === 'lat') { lon = p1.val; lat = p2.val; }
                else if (p1.type === 'unknown' && p2.type === 'unknown') {
                    // Fallback to Order: Lat, Lon
                    lat = p1.val;
                    lon = p2.val;
                }
            }
        }

        if (lat !== null && lon !== null) {
            // Basic validation
            if (!isNaN(lat) && !isNaN(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180) {
                return { lat, lon, type: 'coordinate' };
            }
        }
    }

    // 2. Try Plus Code
    try {
        // Attempt 1: Raw trimmed input or first part (handle "8FVC+GH City")
        // Split by comma or space to isolate potential code
        const parts = trimmed.split(/[\s,]+/);
        const potentialCode = parts[0];

        // Check full string first (standard)
        if (OLC && OLC.isValid && OLC.isValid(trimmed) && OLC.isFull(trimmed)) {
            const decoded = OLC.decode(trimmed);
            return { lat: decoded.latitudeCenter, lon: decoded.longitudeCenter, type: 'plus_code' };
        }

        // Check first part if it looks like a code (e.g. "XJ7R+GH")
        // Relaxed length check to allow valid short codes if library accepts them
        if (potentialCode.length >= 6 && potentialCode.includes('+')) {
            if (OLC && OLC.isValid && OLC.isValid(potentialCode) && OLC.isFull(potentialCode)) {
                const decoded = OLC.decode(potentialCode);
                return { lat: decoded.latitudeCenter, lon: decoded.longitudeCenter, type: 'plus_code' };
            }
        }

        // Attempt 2: Handle "8FVC GH" -> "8FVC+GH" format (Short code or formatted)
        // Only if it doesn't have a plus already
        if (!trimmed.includes('+')) {
            const query = trimmed.toUpperCase().replace(/\s+/g, '+');
            if (OLC && OLC.isValid && OLC.isValid(query) && OLC.isFull(query)) {
                const decoded = OLC.decode(query);
                return { lat: decoded.latitudeCenter, lon: decoded.longitudeCenter, type: 'plus_code' };
            }
        }
    } catch (e) {
        // Ignore
    }

    return null;
}

/**
 * Calculates distance between two coordinates in kilometers using Haversine formula
 */
export function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371; // Earth's radius in km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

/**
 * Calculates the common geohash prefix shared by all waypoints.
 * Used for route optimization - query at a precision that covers the entire route.
 * @param waypoints Array of coordinates to find common prefix for
 * @param precision Maximum precision to encode (default 10)
 * @returns Common prefix string, or empty string if no common prefix
 */
export function getCommonGeohashPrefix(
    waypoints: { lat: number; lon: number }[],
    precision: number = 10
): string {
    if (!waypoints || waypoints.length === 0) return '';

    // Encode all waypoints to geohashes
    const hashes = waypoints.map(wp => encodeGeohash(wp.lat, wp.lon, precision));

    if (hashes.length === 0) return '';
    if (hashes.length === 1) return hashes[0].substring(0, 5); // Single waypoint, use 5-char

    // Find common prefix character by character
    let prefix = '';
    const first = hashes[0];

    for (let i = 0; i < first.length; i++) {
        const char = first[i];
        const allMatch = hashes.every(h => i < h.length && h[i] === char);
        if (allMatch) {
            prefix += char;
        } else {
            break;
        }
    }

    return prefix;
}

export interface NominatimResult {
    place_id: number;
    lat: string;
    lon: string;
    display_name: string;
    type: string;
}

/**
 * Performs an online search using Nominatim (OSM) and Google Plus Codes.
 * Returns the best match or null.
 */
export async function searchLocation(
    query: string,
    countryCode?: string | null,
    currentLocation?: [number, number] | null
): Promise<NominatimResult | null> {
    if (!query || query.length < 3) return null;

    // Run both searches in parallel for faster results
    const plusCodeSearch = async (): Promise<NominatimResult | null> => {
        try {
            // Check for context-based Plus Code (e.g. "8FVC+GH City")
            const firstSpaceIndex = query.indexOf(' ');
            if (firstSpaceIndex > 3 && query.includes('+')) {
                const potentialCode = query.substring(0, firstSpaceIndex).trim();
                const context = query.substring(firstSpaceIndex + 1).trim();

                if (potentialCode.includes('+') && context.length > 0) {

                    const contextRes = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(context)}&format=json&limit=1`, {
                        cache: 'no-store',
                        headers: { 'Accept': 'application/json' }
                    });
                    const contextData = await contextRes.json();

                    if (contextData && contextData.length > 0) {
                        const refLat = parseFloat(contextData[0].lat);
                        const refLon = parseFloat(contextData[0].lon);
                        const recovered = recoverPlusCode(potentialCode, refLat, refLon);
                        if (recovered) {
                            return {
                                place_id: -1,
                                lat: recovered.lat.toString(),
                                lon: recovered.lon.toString(),
                                display_name: `Plus Code: ${potentialCode.toUpperCase()}, ${contextData[0].display_name}`,
                                type: 'plus_code'
                            };
                        }
                    }
                }
            } else {
                // Direct Plus Code search (e.g. coordinates or full code)
                const parsed = parseCoordinate(query);
                if (parsed) {
                    return {
                        place_id: -1,
                        lat: parsed.lat.toString(),
                        lon: parsed.lon.toString(),
                        display_name: parsed.type === 'plus_code' ? `Plus Code: ${query.toUpperCase()}` : `Location: ${formatCoords(parsed.lat, parsed.lon)}`,
                        type: parsed.type
                    };
                }
            }
        } catch (e) {
            console.error('[Parlens] Plus Code search error:', e);
        }
        return null; // Fallback
    };

    const nominatimSearch = async (): Promise<NominatimResult | null> => {
        try {
            let url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1`;
            if (countryCode) {
                url += `&countrycodes=${countryCode}`;
            }
            if (currentLocation) {
                // Prioritize results near current location
                // viewbox=left,top,right,bottom
                const boxSize = 1.0; // ~100km box
                const left = currentLocation[1] - boxSize;
                const right = currentLocation[1] + boxSize;
                const top = currentLocation[0] + boxSize;
                const bottom = currentLocation[0] - boxSize;
                url += `&viewbox=${left},${top},${right},${bottom}`;
            }

            const res = await fetch(url);
            const data = await res.json();
            if (data && data.length > 0) {
                return data[0] as NominatimResult;
            }
        } catch (e) {
            console.error('[Parlens] Nominatim search error:', e);
        }
        return null;
    };

    try {
        // Race them, or prefer Plus Code if it looks like one?
        // Let's run both. If Plus Code returns valid result, it's usually specific.
        const [pcResult, nomResult] = await Promise.all([plusCodeSearch(), nominatimSearch()]);

        if (pcResult) return pcResult;
        return nomResult;

    } catch (e) {
        console.error('Search failed', e);
        return null;
    }
}

/**
 * Fetches search suggestions from Nominatim.
 */
export async function getSuggestions(
    query: string,
    countryCode?: string | null,
    currentLocation?: [number, number] | null,
    limit: number = 5
): Promise<NominatimResult[]> {
    if (!query || query.length < 3) return [];

    try {
        let url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=${limit}&addressdetails=1`;
        if (countryCode) {
            url += `&countrycodes=${countryCode}`;
        }
        if (currentLocation) {
            const boxSize = 1.0;
            const left = currentLocation[1] - boxSize;
            const right = currentLocation[1] + boxSize;
            const top = currentLocation[0] + boxSize;
            const bottom = currentLocation[0] - boxSize;
            url += `&viewbox=${left},${top},${right},${bottom}`;
        }

        const res = await fetch(url, {
            cache: 'no-store',
            headers: { 'Accept': 'application/json' }
        });
        const data = await res.json();
        return Array.isArray(data) ? data as NominatimResult[] : [];
    } catch (e) {
        console.error('[Parlens] Suggestion fetch error:', e);
        return [];
    }
}
