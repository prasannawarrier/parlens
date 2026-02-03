/**
 * Location smoothing utilities for smooth live tracking
 * Implements Kalman filter for GPS smoothing and bearing stabilization
 */

// Simple 1D Kalman filter for smoothing GPS coordinates
export class KalmanFilter {
    private q: number; // Process noise
    private r: number; // Measurement noise
    private x: number; // Estimated value
    private p: number; // Estimation error covariance
    private k: number; // Kalman gain
    private initialized: boolean = false;

    constructor(q: number = 0.00001, r: number = 0.001) {
        this.q = q;
        this.r = r;
        this.x = 0;
        this.p = 1;
        this.k = 0;
    }

    filter(measurement: number): number {
        if (!this.initialized) {
            this.x = measurement;
            this.initialized = true;
            return measurement;
        }

        // Prediction update
        this.p = this.p + this.q;

        // Measurement update
        this.k = this.p / (this.p + this.r);
        this.x = this.x + this.k * (measurement - this.x);
        this.p = (1 - this.k) * this.p;

        return this.x;
    }

    reset() {
        this.initialized = false;
        this.x = 0;
        this.p = 1;
    }
}

// GPS Location smoother combining lat/lon Kalman filters
export class LocationSmoother {
    private latFilter: KalmanFilter;
    private lonFilter: KalmanFilter;
    private bearingFilter: KalmanFilter;

    private hasLastBearing: boolean = false;

    constructor() {
        // Lower Q = smoother but more lag, higher Q = more responsive but noisier
        // GPS accuracy is typically 3-10m, so we tune for that
        // Round 5 Tuning: reduced R (0.005 -> 0.002) for better accuracy and less offset drift
        // This still smooths GPS noise but stays closer to the true position
        this.latFilter = new KalmanFilter(0.00001, 0.002);
        this.lonFilter = new KalmanFilter(0.00001, 0.002);
        // Bearing filter with higher responsiveness but smoothed to prevent jitter
        // Round 4 Tuning: Q 0.01 -> 0.005 (Slower reaction), R 0.5 -> 0.8 (More smoothing)
        // This stops the "twitching" arrow
        this.bearingFilter = new KalmanFilter(0.005, 0.8);
    }

    // Continuous bearing state for unwrapping circular data
    private cumulativeBearing: number = 0;
    private lastInputBearing: number = 0;

    smoothLocation(lat: number, lon: number): [number, number] {
        return [
            this.latFilter.filter(lat),
            this.lonFilter.filter(lon)
        ];
    }

    // Smooth bearing with additional anti-spin protection
    // ignroeSpeedCheck: Set to true for device compass (magnetic), false for GPS course
    smoothBearing(rawBearing: number, speed: number, ignoreSpeedCheck: boolean = false): number | null {
        // Don't update bearing if speed is too low (GPS heading unreliable)
        // Unless we are tracking device orientation (compass), which works at 0 speed.
        if (!ignoreSpeedCheck && speed < 2) {
            return null; // Keep current bearing
        }

        // Normalize input bearing to 0-360
        const currentBearing = ((rawBearing % 360) + 360) % 360;

        // Initialize if this is the first reading
        if (!this.hasLastBearing) {
            this.lastInputBearing = currentBearing;
            this.cumulativeBearing = currentBearing;
            this.hasLastBearing = true;
            this.bearingFilter.reset(); // Reset filter state to start at this value
            this.bearingFilter.filter(currentBearing); // Prime the filter
            return currentBearing;
        }

        // Calculate shortest path delta (unwrapping)
        let delta = currentBearing - this.lastInputBearing;

        // Handle wrap-around (shortest path)
        if (delta > 180) delta -= 360;
        else if (delta < -180) delta += 360;

        // Apply delta to cumulative bearing (creates a continuous line for the filter)
        this.cumulativeBearing += delta;
        this.lastInputBearing = currentBearing;

        // Feed continuous value into Kalman filter
        // The filter now sees a linear progression (e.g. 350 -> 360 -> 370) instead of a jump
        const smoothedContinuous = this.bearingFilter.filter(this.cumulativeBearing);

        // Normalize result back to 0-360 for UI
        const normalizedBearing = ((smoothedContinuous % 360) + 360) % 360;

        return normalizedBearing;
    }

    reset() {
        this.latFilter.reset();
        this.lonFilter.reset();
        this.bearingFilter.reset();
        this.cumulativeBearing = 0;
        this.lastInputBearing = 0;
        this.hasLastBearing = false;
    }
}

// Bearing animator that handles wrap-around correctly for CSS rotation
export class BearingAnimator {
    private currentRotation: number = 0; // Cumulative rotation (can go beyond 360)
    private lastRawBearing: number = 0;
    private initialized: boolean = false;

    // Update target bearing and calculate shortest rotation path
    setBearing(newBearing: number): number {
        // Normalize input to 0-360
        const normalizedBearing = ((newBearing % 360) + 360) % 360;

        if (!this.initialized) {
            this.currentRotation = normalizedBearing;
            this.lastRawBearing = normalizedBearing;
            this.initialized = true;
            return this.currentRotation;
        }

        // Calculate the shortest path delta
        let delta = normalizedBearing - this.lastRawBearing;

        // Wrap-around: choose shortest path
        if (delta > 180) {
            delta -= 360;
        } else if (delta < -180) {
            delta += 360;
        }

        // Apply delta to cumulative rotation
        this.currentRotation += delta;
        this.lastRawBearing = normalizedBearing;

        return this.currentRotation;
    }

    getCurrentRotation(): number {
        return this.currentRotation;
    }

    reset(currentStartBearing: number = 0) {
        this.currentRotation = currentStartBearing;
        this.lastRawBearing = ((currentStartBearing % 360) + 360) % 360;
        this.initialized = true; // Initialize immediately to avoid jump on first setBearing
    }
}

// LERP (Linear Interpolation) animator for smooth position transitions
export class PositionAnimator {
    private startLat: number = 0;
    private startLon: number = 0;
    private targetLat: number = 0;
    private targetLon: number = 0;
    private currentLat: number = 0; // Track actual current position
    private currentLon: number = 0;
    private startTime: number = 0;
    private duration: number = 300; // ms
    private animationId: number | null = null;
    private onUpdate: ((lat: number, lon: number) => void) | null = null;

    setUpdateCallback(callback: (lat: number, lon: number) => void) {
        this.onUpdate = callback;
    }

    animateTo(lat: number, lon: number, durationMs: number = 300) {
        // Cancel any existing animation
        if (this.animationId !== null) {
            cancelAnimationFrame(this.animationId);
        }

        // If no previous position, jump directly
        if (this.targetLat === 0 && this.targetLon === 0) {
            this.targetLat = lat;
            this.targetLon = lon;
            this.currentLat = lat;
            this.currentLon = lon;
            if (this.onUpdate) {
                this.onUpdate(lat, lon);
            }
            return;
        }

        // Start animation from CURRENT position (smooth chaining)
        // Prevents "teleport" vibration if a new update arrives mid-animation
        this.startLat = this.currentLat || this.targetLat;
        this.startLon = this.currentLon || this.targetLon;
        this.targetLat = lat;
        this.targetLon = lon;
        this.startTime = performance.now();
        this.duration = durationMs;

        this.animate();
    }

    private animate = () => {
        const now = performance.now();
        const elapsed = now - this.startTime;
        const progress = Math.min(elapsed / this.duration, 1);

        // Ease-out curve for natural deceleration
        const eased = 1 - Math.pow(1 - progress, 3);

        const currentLat = this.startLat + (this.targetLat - this.startLat) * eased;
        const currentLon = this.startLon + (this.targetLon - this.startLon) * eased;

        this.currentLat = currentLat;
        this.currentLon = currentLon;

        if (this.onUpdate) {
            this.onUpdate(currentLat, currentLon);
        }

        if (progress < 1) {
            this.animationId = requestAnimationFrame(this.animate);
        } else {
            this.animationId = null;
        }
    };

    stop() {
        if (this.animationId !== null) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }
    }
}

// Accelerometer helper for velocity estimation
export class AccelerometerHelper {
    private lastTimestamp: number = 0;
    private velocityX: number = 0;
    private velocityY: number = 0;
    private isListening: boolean = false;
    private permissionGranted: boolean = false;

    async requestPermission(): Promise<boolean> {
        // Check if permission API exists (iOS 13+)
        if (typeof (DeviceMotionEvent as any).requestPermission === 'function') {
            try {
                const permission = await (DeviceMotionEvent as any).requestPermission();
                this.permissionGranted = permission === 'granted';
                return this.permissionGranted;
            } catch (e) {
                console.warn('Accelerometer permission denied:', e);
                return false;
            }
        }
        // Permission not needed on other platforms
        this.permissionGranted = true;
        return true;
    }

    start(onVelocityUpdate?: (vx: number, vy: number) => void) {
        if (this.isListening || !this.permissionGranted) return;

        const handler = (event: DeviceMotionEvent) => {
            const accel = event.accelerationIncludingGravity;
            if (!accel || accel.x === null || accel.y === null) return;

            const now = performance.now();
            if (this.lastTimestamp === 0) {
                this.lastTimestamp = now;
                return;
            }

            const dt = (now - this.lastTimestamp) / 1000;
            this.lastTimestamp = now;

            // Simple velocity integration (with decay to prevent drift)
            const decay = 0.95;
            this.velocityX = (this.velocityX + accel.x * dt) * decay;
            this.velocityY = (this.velocityY + accel.y * dt) * decay;

            if (onVelocityUpdate) {
                onVelocityUpdate(this.velocityX, this.velocityY);
            }
        };

        window.addEventListener('devicemotion', handler);
        this.isListening = true;
    }

    getVelocity(): { vx: number; vy: number } {
        return { vx: this.velocityX, vy: this.velocityY };
    }

    stop() {
        this.isListening = false;
        this.velocityX = 0;
        this.velocityY = 0;
    }
}

// Speed classifications - 4 tiers for precise tracking
export type SpeedClass = 'stationary' | 'walking' | 'vehicle' | 'fast_vehicle';

// Stable location tracker with dynamic buffer zone and speed-based updates
export class StableLocationTracker {
    private anchorLat: number = 0;
    private anchorLon: number = 0;
    private displayLat: number = 0;
    private displayLon: number = 0;
    private lastRawLat: number = 0;
    private lastRawLon: number = 0;
    private lastUpdateTime: number = 0;
    private speedHistory: number[] = [];
    private currentSpeedClass: SpeedClass = 'stationary';
    private predictedBearing: number = 0;
    private directionChangeBuffer: number[] = [];

    // Configuration - dynamic based on speed
    private initialized: boolean = false;

    // Dynamic buffer zones based on speed (in meters)
    // Larger buffer = more stable but less responsive
    // Round 6 Tuning: increased stationary buffer for GPS noise when marking parking spots
    private bufferZones: Record<SpeedClass, number> = {
        stationary: 15,      // Increased from 5m to 15m - covers GPS noise (3-10m typical)
        walking: 8,          // Increased from 4m to 8m - smoother walking tracking
        vehicle: 5,          // Increased from 3m to 5m - stable vehicle tracking
        fast_vehicle: 3      // Increased from 2m to 3m - highway speeds
    };

    // Polling intervals based on speed (in ms)
    // Research: >50mph: 5s, 20-50mph: 10s, <20mph: 15s (for fleet tracking)
    // We use more aggressive polling for real-time navigation feel
    private pollIntervals: Record<SpeedClass, number> = {
        stationary: 15000,   // 15s when not moving (battery optimization)
        walking: 5000,       // 5s at walking pace
        vehicle: 2000,       // 2s in vehicle (20-50mph equivalent)
        fast_vehicle: 1000   // 1s at high speed (>50mph equivalent)
    };

    // Animation durations based on speed (in ms)
    // Faster speed = shorter, snappier animations
    private animationDurations: Record<SpeedClass, number> = {
        stationary: 1200,    // Slow, smooth for stationary
        walking: 800,        // Medium for walking
        vehicle: 400,        // Quick for driving
        fast_vehicle: 200    // Snap for highway
    };

    // Haversine distance in meters
    private haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
        const R = 6371000; // Earth radius in meters
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLon = (lon2 - lon1) * Math.PI / 180;
        const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c;
    }

    // Calculate bearing from one point to another
    private calculateBearing(lat1: number, lon1: number, lat2: number, lon2: number): number {
        const dLon = (lon2 - lon1) * Math.PI / 180;
        const y = Math.sin(dLon) * Math.cos(lat2 * Math.PI / 180);
        const x = Math.cos(lat1 * Math.PI / 180) * Math.sin(lat2 * Math.PI / 180) -
            Math.sin(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.cos(dLon);
        const bearing = Math.atan2(y, x) * 180 / Math.PI;
        return (bearing + 360) % 360;
    }

    // Update location and return stable display position
    updateLocation(rawLat: number, rawLon: number): {
        displayLat: number;
        displayLon: number;
        speed: number;
        speedClass: SpeedClass;
        shouldUpdate: boolean;
        animationDuration: number;
        bearing: number | null;
    } {
        const now = Date.now();

        if (!this.initialized) {
            this.anchorLat = rawLat;
            this.anchorLon = rawLon;
            this.displayLat = rawLat;
            this.displayLon = rawLon;
            this.lastRawLat = rawLat;
            this.lastRawLon = rawLon;
            this.lastUpdateTime = now;
            this.initialized = true;
            return {
                displayLat: rawLat,
                displayLon: rawLon,
                speed: 0,
                speedClass: 'stationary',
                shouldUpdate: true,
                animationDuration: 0,
                bearing: null
            };
        }

        // Calculate distance from anchor
        const distanceFromAnchor = this.haversineDistance(this.anchorLat, this.anchorLon, rawLat, rawLon);

        // Calculate speed (m/s)
        const timeDelta = (now - this.lastUpdateTime) / 1000;
        const distanceMoved = this.haversineDistance(this.lastRawLat, this.lastRawLon, rawLat, rawLon);
        const speed = timeDelta > 0 ? distanceMoved / timeDelta : 0;

        // Update speed history (keep last 5)
        this.speedHistory.push(speed);
        if (this.speedHistory.length > 5) this.speedHistory.shift();

        // Average speed for classification
        const avgSpeed = this.speedHistory.reduce((a, b) => a + b, 0) / this.speedHistory.length;

        // Classify speed - 4 tiers for precise tracking
        let speedClass: SpeedClass;
        if (avgSpeed < 0.5) {
            speedClass = 'stationary';
        } else if (avgSpeed < 2) {
            speedClass = 'walking';
        } else if (avgSpeed < 10) {
            speedClass = 'vehicle';
        } else {
            speedClass = 'fast_vehicle';
        }
        this.currentSpeedClass = speedClass;

        // Get current buffer based on speed
        const currentBuffer = this.bufferZones[speedClass];

        // Calculate bearing of movement
        if (distanceMoved > 1) {
            const moveBearing = this.calculateBearing(this.lastRawLat, this.lastRawLon, rawLat, rawLon);
            this.directionChangeBuffer.push(moveBearing);
            if (this.directionChangeBuffer.length > 3) this.directionChangeBuffer.shift();

            // Average recent bearings for prediction
            this.predictedBearing = this.directionChangeBuffer.reduce((a, b) => a + b, 0) / this.directionChangeBuffer.length;
        }

        // Update last raw position
        this.lastRawLat = rawLat;
        this.lastRawLon = rawLon;
        this.lastUpdateTime = now;

        // Buffer zone logic: only update display if outside buffer
        let shouldMoveMarker = false;
        let newDisplayLat = this.displayLat;
        let newDisplayLon = this.displayLon;

        if (distanceFromAnchor > currentBuffer) {
            // Outside buffer - move anchor to new position (Hard Buffer)
            // Center the marker at the new raw position logic
            this.anchorLat = rawLat;
            this.anchorLon = rawLon;
            newDisplayLat = rawLat;
            newDisplayLon = rawLon;
            shouldMoveMarker = true;
        } else {
            // Inside buffer - Strict clamping
            // Keep marker exactly at the anchor (center of the zone)
            // ensuring zero jitter.
            newDisplayLat = this.anchorLat;
            newDisplayLon = this.anchorLon;
            shouldMoveMarker = false;
        }

        if (shouldMoveMarker) {
            this.displayLat = newDisplayLat;
            this.displayLon = newDisplayLon;
        }

        return {
            displayLat: this.displayLat,
            displayLon: this.displayLon,
            speed: avgSpeed,
            speedClass,
            shouldUpdate: shouldMoveMarker,
            animationDuration: this.animationDurations[speedClass],
            bearing: this.predictedBearing
        };
    }

    // Get recommended polling interval based on current speed
    getPollingInterval(): number {
        return this.pollIntervals[this.currentSpeedClass];
    }

    // Get current speed classification
    getSpeedClass(): SpeedClass {
        return this.currentSpeedClass;
    }

    // Get predicted bearing for movement direction
    getPredictedBearing(): number {
        return this.predictedBearing;
    }

    // Track last GPS accuracy for dynamic buffer sizing
    private lastAccuracy: number = 10; // Default 10m

    // Update location with accuracy-aware buffer zone
    // This method dynamically adjusts buffer based on GPS accuracy
    updateLocationWithAccuracy(rawLat: number, rawLon: number, accuracy: number): {
        displayLat: number;
        displayLon: number;
        speed: number;
        speedClass: SpeedClass;
        shouldUpdate: boolean;
        animationDuration: number;
        bearing: number | null;
        accuracy: number;
    } {
        // Store accuracy for reference
        this.lastAccuracy = accuracy;

        // Get base result from standard update
        const result = this.updateLocation(rawLat, rawLon);

        // For stationary check: use accuracy-weighted buffer
        // If we're stationary and GPS accuracy is poor, increase buffer dynamically
        if (result.speedClass === 'stationary') {
            const dynamicBuffer = Math.max(this.bufferZones.stationary, accuracy * 1.5);
            const distanceFromAnchor = this.haversineDistance(this.anchorLat, this.anchorLon, rawLat, rawLon);

            // If within dynamic buffer when stationary, don't update display
            if (distanceFromAnchor <= dynamicBuffer) {
                return {
                    ...result,
                    displayLat: this.displayLat, // Keep current display position
                    displayLon: this.displayLon,
                    shouldUpdate: false,
                    accuracy
                };
            }
        }

        return {
            ...result,
            accuracy
        };
    }

    // Get last reported GPS accuracy
    getLastAccuracy(): number {
        return this.lastAccuracy;
    }

    // Get average speed from history (for hysteresis checks)
    getSpeedHistoryAverage(): number {
        if (this.speedHistory.length === 0) return 0;
        return this.speedHistory.reduce((a, b) => a + b, 0) / this.speedHistory.length;
    }

    reset() {
        this.initialized = false;
        this.anchorLat = 0;
        this.anchorLon = 0;
        this.displayLat = 0;
        this.displayLon = 0;
        this.speedHistory = [];
        this.currentSpeedClass = 'stationary';
        this.directionChangeBuffer = [];
    }
}
