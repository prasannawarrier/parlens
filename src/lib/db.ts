export interface StoredEvent {
    id: string; // Nostr Event ID
    pubkey: string;
    created_at: number;
    kind: number;
    tags: string[][];
    content: string;
    geohash?: string; // Extracted for indexing
    seen_at: number; // For LRU cleanup if needed
}

export class ParkingDatabase {
    private dbName = 'parlens_db';
    private version = 1;
    private db: IDBDatabase | null = null;
    private storeName = 'parking_events';

    async init(): Promise<void> {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, this.version);

            request.onerror = () => {
                console.error('[Parlens/DB] Failed to open DB');
                reject(request.error);
            };

            request.onsuccess = () => {
                this.db = request.result;
                // console.log('[Parlens/DB] Database initialized');
                resolve();
            };

            request.onupgradeneeded = (event) => {
                const db = (event.target as IDBOpenDBRequest).result;
                if (!db.objectStoreNames.contains(this.storeName)) {
                    const store = db.createObjectStore(this.storeName, { keyPath: 'id' }); // Use Event ID as key
                    store.createIndex('geohash', 'geohash', { unique: false });
                    store.createIndex('created_at', 'created_at', { unique: false });
                    store.createIndex('kind', 'kind', { unique: false });
                }
            };
        });
    }

    async addEvent(event: any, computedGeohash?: string): Promise<void> {
        if (!this.db) await this.init();
        return new Promise((resolve, reject) => {
            if (!this.db) return reject('DB not initialized');

            const transaction = this.db.transaction([this.storeName], 'readwrite');
            const store = transaction.objectStore(this.storeName);

            // Use computed geohash if provided, otherwise fallback to tag or empty
            const geohash = computedGeohash || event.tags.find((t: string[]) => t[0] === 'g')?.[1] || '';

            const storedEvent: StoredEvent = {
                id: event.id,
                pubkey: event.pubkey,
                created_at: event.created_at,
                kind: event.kind,
                tags: event.tags,
                content: event.content,
                geohash,
                seen_at: Date.now()
            };

            const request = store.put(storedEvent); // 'put' acts as upsert

            request.onsuccess = () => resolve();
            request.onerror = () => {
                // Ignore duplicates or constraint errors
                resolve();
            };
        });
    }

    async addEvents(items: { event: any, computedGeohash?: string }[]): Promise<void> {
        if (!this.db) await this.init();
        if (items.length === 0) return;

        return new Promise((resolve, reject) => {
            if (!this.db) return reject('DB not initialized');
            const transaction = this.db.transaction([this.storeName], 'readwrite');
            const store = transaction.objectStore(this.storeName);

            items.forEach(({ event, computedGeohash }) => {
                const geohash = computedGeohash || event.tags.find((t: string[]) => t[0] === 'g')?.[1] || '';
                const storedEvent: StoredEvent = {
                    id: event.id,
                    pubkey: event.pubkey,
                    created_at: event.created_at,
                    kind: event.kind,
                    tags: event.tags,
                    content: event.content,
                    geohash,
                    seen_at: Date.now()
                };
                store.put(storedEvent);
            });

            transaction.oncomplete = () => resolve();
            transaction.onerror = () => reject(transaction.error);
        });
    }

    async getEventsByGeohashes(geohashes: string[]): Promise<any[]> {
        if (!this.db) await this.init();
        return new Promise((resolve, reject) => {
            if (!this.db) return reject('DB not initialized');

            // This is a naive implementation: multiple queries. 
            // Since we usually have 9 neighbors, 9 small async queries is fine.
            const results: any[] = [];
            const transaction = this.db.transaction([this.storeName], 'readonly');
            const store = transaction.objectStore(this.storeName);
            const index = store.index('geohash');

            let completed = 0;

            if (geohashes.length === 0) {
                resolve([]);
                return;
            }

            geohashes.forEach(g => {
                const request = index.getAll(IDBKeyRange.only(g));

                request.onsuccess = () => {
                    results.push(...request.result);
                    completed++;
                    if (completed === geohashes.length) {
                        resolve(results);
                    }
                };
                request.onerror = () => {
                    completed++;
                    if (completed === geohashes.length) resolve(results);
                }
            });
        });
    }

    // For pruning
    async deleteEvent(id: string): Promise<void> {
        if (!this.db) await this.init();
        return new Promise((resolve, reject) => {
            if (!this.db) return reject('DB not initialized');
            const transaction = this.db.transaction([this.storeName], 'readwrite');
            const store = transaction.objectStore(this.storeName);
            store.delete(id);
            transaction.oncomplete = () => resolve();
        });
    }
}

export const parkingDB = new ParkingDatabase();
