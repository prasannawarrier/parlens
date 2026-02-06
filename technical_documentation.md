# Parlens Technical Architecture & Session Flows

This document provides a comprehensive technical overview of the Parlens PWA. It details the core architecture, map engine mechanics, search flows, and the parking session lifecycle, explaining how local state interacts with the Nostr protocol.

---

## 1. Core Architecture

Parlens is designed as a **Local-First, Privacy-Centric** Progressive Web App. It minimizes reliance on central servers by using the Nostr protocol for data sync and peer-to-peer communication.

### 1.1 Technology Stack
*   **Frontend**: React (Vite), TypeScript, TailwindCSS.
*   **Map Engine**: MapLibre GL JS (Vector maps).
*   **Data Layer**: Nostr (WebSocket to Relays) + IndexedDB (Local Caching).
*   **State Management**: React Context + LocalStorage (Persistent User Preferences).
*   **Privacy**: Client-side NIP-44/NIP-04 Encryption for sensitive user data (routes, history).

### 1.2 Data Strategy
*   **Ephemeral keys**: Random keys are generated for anonymous sessions to protect identity.
*   **Optimistic UI**: Local state is updated immediately (`status`, `parkLocation`), while network events publish in the background.
*   **Offline Capable**: The app functions using cached data (IndexedDB) and minimal `localStorage` state when disconnected.

---

## 2. Map & Location Engine

The map experience is built on a custom location smoothing engine to handle the inherent noise of GPS data, especially in urban canyons.

### 2.1 Location Smoothing (`StableLocationTracker`)
Raw GPS updates are noisy. To prevent the "blue dot" from jumping around when the user is stationary (jitter), we use a **Dynamic Buffer Zone** algorithm.

*   **Speed-Based Classification**: The user's movement is classified into 4 tiers based on average speed:
    *   `stationary` (< 0.5 m/s)
    *   `walking` (< 2 m/s)
    *   `vehicle` (< 10 m/s)
    *   `fast_vehicle` (> 10 m/s)
*   **Dynamic Buffers**: The tracking logic defines a "Buffer Zone" around the last known stable anchor point. The display location *only* updates if the user moves outside this radius:
    *   **Stationary**: 15m radius (High buffering to absorb GPS drift).
    *   **Walking**: 8m radius.
    *   **Vehicle**: 5m radius.
    *   **Fast**: 3m radius (Low buffering for responsiveness).
*   **Result**: The user sees a smooth, stable marker that snaps to movement but stays still when they stop.

### 2.2 Orientation & Heading
The map supports three orientation modes to suit different contexts:

1.  **Auto (Compass/GPS)**:
    *   **Motion**: When moving > 2m/s, heading is derived from the GPS vector (Bearing).
    *   **Static**: Uses device magnetometer (`DeviceOrientationEvent`) if available (requires iOS permission).
    *   *Implementation*: A `BearingAnimator` handles the tricky math of wrapping around 359° -> 0° to prevent "spinning" transitions.
2.  **Fixed (North Up)**:
    *   Locks bearing to 0°.
    *   **Automatic Trigger**: When a user enters the **Parked** state, the map automatically switches to Fixed mode to provide a stable reference frame for finding their car.
3.  **Recentre**:
    *   Keeps the user location centered on screen but allows free rotation.

---

## 3. Search & Discovery Flows

Discovery in Parlens relies on a **Geohash Grid** system rather than a central search API.

### 3.1 Geohash Spatial Indexing
*   **Grid Size**: Level 5 Geohashes (approx. 5km x 5km).
*   **Logic**: The app subscribes to the users's current geohash cell + its 8 neighbors (9 cells total).
*   **Discovery**: As the user moves, the subscription updates to new cells, fetching parking spots (`Kind 31714` public, `Kind 37141` listed) relevant to that area.

### 3.2 Staged Data Loading
To ensure the map feels fast, data is loaded in three stages:
1.  **L0 (Cache)**: IndexedDB immediately returns previously seen spots for the area.
2.  **L1 (Public)**: Relays return "Public" spots and "No Parking" flags (`Kind 1985`).
3.  **L2 (Listed)**: Relays return "Listed" commercial spots. These require validation (checking looking up the parent Listing Metadata `Kind 31147`) before display.

### 3.3 Waypoint Search (Routes)
When creating routes, the search bar aggregates results from:
1.  **Nominatim (OSM)**: For address queries. throttled and biased to user location.
2.  **Plus Codes**: For exact coordinate precision.
3.  **Saved Routes (My Data)**: Decrypted `Kind 34171` events from the user's private log.

---

## 4. Parking Session Lifecycle

The app handles two distinct types of parking sessions: **User-Managed** (Public) and **Verified** (Listed).

### 4.1 User-Managed Session
*   **Use Case**: Street parking, unmanaged lots.
*   **Start**:
    *   **Action**: User taps FAB "Park Here".
    *   **State**: Updates local `parlens_session` object. **No network event is published** (Privacy first).
*   **End**:
    *   **Action**: User taps "End Session".
    *   **Event 1 (Private)**: Publishes `Kind 31417` (Parking Log) encrypted with user's key for history.
    *   **Event 2 (Public - Optional)**: Publishes `Kind 31714` (Area Indicator) using an ephemeral key to tell the network "A spot just opened up here".

### 4.2 Listed Verified Session
*   **Use Case**: Private garages, secure lots.
*   **Start**:
    *   **Action**: User scans a Parlens QR Code.
    *   **Validation**: checks `qr_type` (static vs dynamic).
    *   **Event**: Publishes `Kind 1714` (Spot Status) marking the specific spot ID as `'occupied'`.
*   **Auth**: The update includes an `authorizer` tag. The Listing Owner's policy determines if this specific user (or the generic code) is allowed to update that spot.
*   **End**:
    *   **Action**: User ends session/pays.
    *   **Event**: Publishes `Kind 1714` marking the spot `'open'`.

---

## 5. Ecosystem Governance

Parlens is decentralized but supports moderation features for quality control.

### 5.1 Listing Approvals
*   **Problem**: Preventing spam listings on the public map.
*   **Solution**: "Public" type listings require an Approval Label.
    *   **Mechanic**: Determining if a listing shows up depends on checking for a `Kind 1985` (Label) event signed by a trusted `APPROVER_PUBKEY`.
    *   **Pending**: Unapproved listings are visible only to their owners (or in a "Pending" view for the approver).

### 5.2 Community Flags
*   **No Parking**: Users can flag locations as illegal/restricted.
    *   **Event**: `Kind 1985` with `l=no-parking`.
    *   **Display**: Renders a warning zone on the map.
*   **Hiding**: Users can locally "Hide" specific listings or owners (saved to `localStorage`).

---

## 6. Nostr Event Reference

| Kind | Name | Scope | Privacy | Purpose |
| :--- | :--- | :--- | :--- | :--- |
| **31417** | `PARKING_LOG` | User | Encrypted | Personal history of sessions. |
| **31714** | `PARKING_AREA_INDICATOR` | Public | Cleartext | Anonymous "Spot Open" signal. |
| **1714** | `LISTED_SPOT_LOG` | Public | Cleartext | Live status (occupied/open) of a managed spot. |
| **31147** | `LISTED_PARKING_METADATA` | Public | Cleartext | Parking lot details (Rates, Location). |
| **37141** | `PARKING_SPOT_LISTING` | Public | Cleartext | Individual spot definition. |
| **1985** | `LABEL` | Public | Cleartext | Approvals & Flags. |
| **34171** | `ROUTE_LOG` | User | Encrypted | Saved navigation routes. |
