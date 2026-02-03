/**
 * Relay Health Monitoring
 * Tracks relay connectivity and performance for optimized querying
 */

export interface RelayHealth {
    url: string;
    connected: boolean;
    lastSuccess: number;
    lastFailure: number;
    avgLatency: number;
    failureCount: number;
    successCount: number;
}

class RelayHealthMonitor {
    private relayHealth: Map<string, RelayHealth> = new Map();
    private listeners = new Set<(stats: Map<string, RelayHealth>) => void>();

    /**
     * Subscribe to health updates
     */
    subscribe(callback: (stats: Map<string, RelayHealth>) => void): () => void {
        this.listeners.add(callback);
        // Immediate callback with current state
        callback(this.relayHealth);
        return () => this.listeners.delete(callback);
    }

    private notifyListeners() {
        this.listeners.forEach(listener => listener(this.relayHealth));
    }

    /**
     * Initialize health tracking for relays
     */
    initialize(relays: string[]): void {
        relays.forEach(url => {
            if (!this.relayHealth.has(url)) {
                this.relayHealth.set(url, {
                    url,
                    connected: true, // Assume connected initially
                    lastSuccess: Date.now(),
                    lastFailure: 0,
                    avgLatency: 0,
                    failureCount: 0,
                    successCount: 0
                });
            }
        });
    }

    /**
     * Record a successful relay interaction
     */
    recordSuccess(url: string, latencyMs: number): void {
        const health = this.relayHealth.get(url);
        if (health) {
            health.connected = true;
            health.lastSuccess = Date.now();
            health.successCount++;
            // Rolling average latency
            health.avgLatency = health.avgLatency === 0
                ? latencyMs
                : (health.avgLatency * 0.8) + (latencyMs * 0.2);
            this.notifyListeners();
        }
    }

    /**
     * Record a relay failure (timeout, error, etc.)
     */
    recordFailure(url: string): void {
        const health = this.relayHealth.get(url);
        if (health) {
            health.lastFailure = Date.now();
            health.failureCount++;

            // Mark as disconnected after 3 consecutive failures
            // (simplified logic - in production, use time-windowed failure rate)
            if (health.failureCount >= 3 &&
                (Date.now() - health.lastSuccess) > 30000) {
                health.connected = false;
                console.warn(`[Parlens] Relay ${url} marked unhealthy after ${health.failureCount} failures`);
            }
            this.notifyListeners();
        }
    }

    /**
     * Get healthy relays (connected and responsive)
     */
    getHealthyRelays(relays: string[]): string[] {
        const healthy = relays.filter(url => {
            const health = this.relayHealth.get(url);
            if (!health) return true; // Unknown = assume healthy
            return health.connected;
        });

        // Always return at least one relay (best effort)
        if (healthy.length === 0 && relays.length > 0) {
            // Reset and try all relays
            this.resetAll();
            return relays;
        }

        return healthy;
    }

    /**
     * Get relays sorted by performance (fastest first)
     */
    getSortedByLatency(relays: string[]): string[] {
        return [...relays].sort((a, b) => {
            const healthA = this.relayHealth.get(a);
            const healthB = this.relayHealth.get(b);
            const latencyA = healthA?.avgLatency || 0;
            const latencyB = healthB?.avgLatency || 0;
            return latencyA - latencyB;
        });
    }

    /**
     * Mark a relay as reconnected (e.g., after successful connection)
     */
    markConnected(url: string): void {
        const health = this.relayHealth.get(url);
        if (health) {
            health.connected = true;
            health.failureCount = 0;
        }
    }

    /**
     * Reset all relays to healthy state
     */
    resetAll(): void {
        this.relayHealth.forEach(health => {
            health.connected = true;
            health.failureCount = 0;
        });
        this.notifyListeners();
    }

    /**
     * Refresh connection status (alias for resetAll to wake up relays)
     */
    refresh(): void {
        this.resetAll();
    }

    /**
     * Get health stats for debugging
     */
    getStats(): RelayHealth[] {
        return Array.from(this.relayHealth.values());
    }
}

// Singleton instance
export const relayHealthMonitor = new RelayHealthMonitor();
