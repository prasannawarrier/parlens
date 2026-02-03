/**
 * Clustering utility for grouping spots based on zoom level.
 * Uses geohash truncation for efficient spatial grouping.
 */

import { encodeGeohash } from './geo';

export interface SpotBase {
    id: string;
    lat: number;
    lon: number;
    price: number;
    currency: string;
    count?: number; // Weighted count (e.g. for listings)
}

export interface Cluster<T extends SpotBase> {
    id: string;
    lat: number;
    lon: number;
    spots: T[];
    minPrice: number;
    maxPrice: number;
    currency: string;
    count: number;
}

/**
 * Maps zoom level to geohash precision for clustering.
 * Lower zoom = lower precision = bigger clusters.
 */
function getClusterPrecision(zoom: number): number {
    if (zoom >= 4) return 7;
    return 4;
}

/**
 * Clusters spots by truncated geohash based on current zoom level.
 * Returns original spots if zoom is high enough, otherwise returns clusters.
 */
export function clusterSpots<T extends SpotBase>(
    spots: T[],
    zoom: number,
    shouldCluster: boolean = true,
    maxPrecision: number = 8
): (T | Cluster<SpotBase>)[] {
    // Always cluster if there are at least 2 spots
    if (!shouldCluster || spots.length < 2) {
        // BUT if any spot has count > 1 (listing), we must return it as a cluster? 
        // No, LandingPage checks isCluster which checks valid props.
        // Actually, if we return T (Spot), it doesn't have minPrice.
        // If a listing has count 5, we might want to display "5".
        // LandingPage map loop handles T or Cluster.
        // If T has count 5, logic in LandingPage needs to handle it.
        // The clusterSpots return loop creates the Cluster object. 
        // So skipping this function for <2 spots might skip creating the Cluster wrapper.
        // Let's remove this early return optimization if we have weighted spots.
        const hasWeighted = spots.some(s => (s.count || 1) > 1);
        if (!hasWeighted && spots.length < 2) return spots;
    }

    // Apply maxPrecision cap
    const calculatedPrecision = getClusterPrecision(zoom);
    const precision = Math.min(calculatedPrecision, maxPrecision);
    const clusters = new Map<string, Cluster<T>>();

    for (const spot of spots) {
        // At high zoom levels (>=15), use rounded coordinates for grouping to catch nearby spots
        // 4 decimal places = ~11m precision, catches GPS jitter and same-spot duplicates
        // At lower zoom levels, use geohash for broader clustering
        // BUT if precision is capped (e.g. maxPrecision=7), we MUST use geohash regardless of zoom
        const useCoordinateRounding = zoom >= 15 && precision >= 8;

        // Include currency in hash to prevent clustering different currencies
        const locationHash = useCoordinateRounding
            ? `${spot.lat.toFixed(4)},${spot.lon.toFixed(4)}`
            : encodeGeohash(spot.lat, spot.lon, precision);
        const hash = `${locationHash}:${spot.currency}`;

        const spotWeight = spot.count || 1;

        if (clusters.has(hash)) {
            const cluster = clusters.get(hash)!;
            cluster.spots.push(spot);
            cluster.count += spotWeight;
            cluster.minPrice = Math.min(cluster.minPrice, spot.price);
            cluster.maxPrice = Math.max(cluster.maxPrice, spot.price);
            // Update center to average (weighted? simple average of locations is decent enough)
            // Ideally weighted average but simple is fine for visual center.
            // Actually, cluster.lat/lon is updated iteratively?
            // "cluster.lat = cluster.spots.reduce... / cluster.spots.length"
            // Re-calculating average every time.
            const totalCount = cluster.spots.length; // Number of items, not weight
            cluster.lat = cluster.spots.reduce((sum, s) => sum + Number(s.lat), 0) / totalCount;
            cluster.lon = cluster.spots.reduce((sum, s) => sum + Number(s.lon), 0) / totalCount;
        } else {
            clusters.set(hash, {
                id: `cluster-${hash}`,
                lat: spot.lat,
                lon: spot.lon,
                spots: [spot],
                minPrice: spot.price,
                maxPrice: spot.price,
                currency: spot.currency,
                count: spotWeight
            });
        }
    }

    // Return clusters only when there are multiple unique spots clustered together
    // A single spot with high count should NOT be treated as a cluster
    const result: (T | Cluster<T>)[] = [];
    for (const cluster of clusters.values()) {
        if (cluster.spots.length === 1) {
            // Single unique spot - return as individual item (even if it has high count)
            result.push(cluster.spots[0]);
        } else {
            // Multiple unique spots clustered together - return as cluster
            result.push(cluster);
        }
    }

    return result;
}

/**
 * Helper to check if an item is a cluster.
 */
export function isCluster<T extends SpotBase>(item: T | Cluster<T>): item is Cluster<T> {
    // Check for spots array with multiple items (true zoom-level clustering)
    // This ensures single spots with high report count don't show cluster badge
    return 'spots' in item && Array.isArray((item as any).spots) && (item as any).spots.length > 1;
}
