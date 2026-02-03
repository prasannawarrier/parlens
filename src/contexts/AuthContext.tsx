import { SimplePool, getPublicKey, nip19, generateSecretKey, finalizeEvent } from 'nostr-tools';
import { DEFAULT_RELAYS } from '../lib/nostr';
import { relayHealthMonitor } from '../lib/relayHealth';

const bytesToHex = (bytes: Uint8Array) =>
    Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');

import React, { createContext, useContext, useState, useEffect } from 'react';

interface AuthContextType {
    pubkey: string | null;
    login: (method: 'extension' | 'nsec' | 'bunker' | 'create', value?: string, username?: string) => Promise<void>;
    logout: () => void;
    deleteAccount: () => Promise<void>;
    pool: SimplePool;
    signEvent: (event: any) => Promise<any>;
    refreshConnections: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [pubkey, setPubkey] = useState<string | null>(localStorage.getItem('parlens_pubkey'));
    // SimplePool with iOS-friendly settings for reliable connections
    // enablePing: sends heartbeats to detect dropped connections (critical for iOS)
    // enableReconnect: automatically reconnects when connections fail
    const [pool, setPool] = useState(() => new SimplePool({ enablePing: true, enableReconnect: true }));

    // Initialize relay health monitoring on mount
    useEffect(() => {
        relayHealthMonitor.initialize(DEFAULT_RELAYS);
    }, []);

    // Force reconnect logic
    const refreshConnections = async () => {

        // 1. Close existing connections to clear "zombies"
        try {
            pool.close(DEFAULT_RELAYS);
        } catch (e) {
            console.warn('[Parlens] Error closing connections:', e);
        }

        // 2. Reset health monitor stats
        relayHealthMonitor.resetAll();

        // 3. Create a fresh pool instance to guarantee clean state
        const newPool = new SimplePool({ enablePing: true, enableReconnect: true });

        // Wait for connections to establish (warming up the pool)
        // This ensures the spinner keeps spinning until we are actually connected
        await Promise.allSettled(DEFAULT_RELAYS.map(url => newPool.ensureRelay(url)));

        // 4. Update state to trigger all downstream useEffects to re-subscribe
        setPool(newPool);

    };

    // Reset relay health when app comes back from background (iOS reliability)
    useEffect(() => {
        let lastHiddenTime = 0;
        const handleVisibilityChange = () => {
            if (document.visibilityState === 'hidden') {
                lastHiddenTime = Date.now();
            } else if (document.visibilityState === 'visible' && lastHiddenTime > 0) {
                const hiddenDuration = Date.now() - lastHiddenTime;
                // If backgrounded for more than 5 seconds, reset relay health
                // This helps reconnect stale connections on iOS
                if (hiddenDuration > 5000) {
                    refreshConnections();
                }
            }
        };
        document.addEventListener('visibilitychange', handleVisibilityChange);
        return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
    }, [pool]);

    const login = async (method: 'extension' | 'nsec' | 'bunker' | 'create', value?: string, username?: string) => {
        let key = '';
        let privateKey: Uint8Array | null = null;

        if (method === 'extension') {
            if (!(window as any).nostr) {
                throw new Error('Nostr extension not found');
            }
            key = await (window as any).nostr.getPublicKey();
        } else if (method === 'nsec' && value) {
            try {
                const decoded = nip19.decode(value);
                if (decoded.type !== 'nsec') throw new Error('Not an nsec');
                privateKey = decoded.data as Uint8Array;
                key = getPublicKey(privateKey);
                localStorage.setItem('parlens_privkey', bytesToHex(privateKey));
            } catch (e) {
                throw new Error('Invalid nsec format');
            }
        } else if (method === 'create') {
            privateKey = generateSecretKey();
            key = getPublicKey(privateKey);
            localStorage.setItem('parlens_privkey', bytesToHex(privateKey));
        }

        setPubkey(key);
        localStorage.setItem('parlens_pubkey', key);

        // Publish metadata if creating account
        if (method === 'create' && username && privateKey) {
            try {
                const profileData = {
                    name: username,
                    display_name: username,
                    picture: `https://api.dicebear.com/7.x/bottts/svg?seed=${key}`
                };

                // Cache profile locally for immediate UI update
                localStorage.setItem('parlens_user_profile', JSON.stringify(profileData));

                const event = finalizeEvent({
                    kind: 0,
                    created_at: Math.floor(Date.now() / 1000),
                    tags: [],
                    content: JSON.stringify(profileData),
                }, privateKey);

                await Promise.any([
                    pool.publish(['wss://relay.damus.io', 'wss://nos.lol'], event)
                ]);
            } catch (e) {
                console.warn('Failed to publish metadata:', e);
            }
        }
    };

    const logout = () => {
        setPubkey(null);
        localStorage.removeItem('parlens_pubkey');
        localStorage.removeItem('parlens_privkey');
    };

    const deleteAccount = async () => {
        if (!pubkey) return;

        // 1. Publish Tombstone Metadata (Kind 0)
        try {
            const event = {
                kind: 0,
                created_at: Math.floor(Date.now() / 1000),
                tags: [],
                content: JSON.stringify({
                    name: 'Deleted User',
                    about: 'This account has been deleted by the user.',
                    picture: '',
                    deleted: true
                })
            };
            const signedEvent = await signEvent(event);
            await Promise.allSettled(pool.publish(DEFAULT_RELAYS, signedEvent));
        } catch (e) {
            console.error('Failed to publish deletion metadata:', e);
            // Continue with local deletion even if network fails
        }

        // 2. Clear Local Data & Logout
        logout();
    };

    const signEvent = async (event: any) => {
        const privkeyHex = localStorage.getItem('parlens_privkey');
        if (privkeyHex) {
            const privkey = new Uint8Array(privkeyHex.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16)));
            return finalizeEvent(event, privkey);
        }

        if ((window as any).nostr) {
            return await (window as any).nostr.signEvent(event);
        }

        throw new Error('No signing method available');
    };

    return (
        <AuthContext.Provider value={{ pubkey, login, logout, deleteAccount, pool, signEvent, refreshConnections }}>
            {children}
        </AuthContext.Provider>
    );
};

export const useAuth = () => {
    const context = useContext(AuthContext);
    if (!context) throw new Error('useAuth must be used within AuthProvider');
    return context;
};
