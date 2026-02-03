import { nip44 } from 'nostr-tools';

/**
 * Encrypts parking log content for Kind 11012 using NIP-44.
 * In a real app, this would use the user's private key or window.nostr.nip44.encrypt.
 */
export async function encryptParkingLog(content: any, pubkey: string, seckey?: Uint8Array): Promise<string> {
    const json = JSON.stringify(content);

    if (seckey) {
        // Basic NIP-44 implementation with local key
        const conversationKey = nip44.getConversationKey(seckey, pubkey);
        return nip44.encrypt(json, conversationKey);
    } else if ((window as any).nostr?.nip44?.encrypt) {
        // Extension implementation
        return await (window as any).nostr.nip44.encrypt(pubkey, json);
    }

    throw new Error('No encryption method available');
}

/**
 * Decrypts parking log content.
 */
export async function decryptParkingLog(payload: string, pubkey: string, seckey?: Uint8Array): Promise<any> {
    let decrypted: string;

    if (seckey) {
        const conversationKey = nip44.getConversationKey(seckey, pubkey);
        decrypted = nip44.decrypt(payload, conversationKey);
    } else if ((window as any).nostr?.nip44?.decrypt) {
        decrypted = await (window as any).nostr.nip44.decrypt(pubkey, payload);
    } else {
        throw new Error('No decryption method available');
    }

    return JSON.parse(decrypted);
}
