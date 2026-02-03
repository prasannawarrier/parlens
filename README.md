# Parlens PWA

Parlens is a decentralized parking utility app built on the Nostr protocol. It allows users to track their parking history, find parking areas reported by other users, list valid parking spots, and plan routes, all without a centralized server holding your data.

## Features

- **Vehicle Types**: Support for Cars, Motorcycles, and Bicycles with custom rates.
- **Parking History**: Log where you parked providing a personal history of your spots.
- **Parking Area Reports**: Share parking availability updates with the community anonymously.
- **Listed Parking**: View and manage formal parking listings with specific spots and rates.
- **No Parking Reporting**: Flag areas where parking is prohibited to warn others.
- **Privacy-First Routing**: Plan routes and save them encrypted to your profile.
- **End-to-End Encryption**: All personal data (logs, routes) is encrypted using NIP-44.
- **PWA Ready**: Installable on iOS and Android for a native app experience.

## Technology Stack

- **Frontend**: React with Vite
- **Language**: TypeScript
- **Styling**: Tailwind CSS
- **Maps**: MapLibre GL
- **Data Fetching**: TanStack Query
- **Routing**: OSRM (Open Source Routing Machine)
- **Protocol**: Nostr (via nostr-tools and @nostrify/react)
- **State Management**: React Context & TanStack Query

## Nostr Event Kinds

Parlens uses specific Nostr event kinds to manage data:

| Kind | Name | Description | Encryption |
|------|------|-------------|------------|
| **31417** | Parking Log | User's personal parking history. | NIP-44 |
| **31714** | Parking Area Report | Anonymous report of a parking area. | Public |
| **34171** | Route Log | User-saved routes and waypoints. | NIP-44 |
| **31147** | Listed Parking Metadata | Metadata for a parking area listing. | Public |
| **37141** | Parking Spot Listing | Individual spot details within a listing. | Public |
| **1714** | Listed Spot Log | Real-time status update for a listed spot. | Public |
| **1417** | Private Log Note | Encrypted status note for parking logs. | NIP-44 |
| **10002** | Relay List | User's preferred relay servers. | Public |
| **1985** | Label | NIP-32 Label for listing approvals and No Parking reports. | Public |

## Getting Started

### Prerequisites

- Node.js (v18 or higher)
- npm or yarn

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/yourusername/parlens-pwa.git
   cd parlens-pwa
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Run the development server:
   ```bash
   npm run dev
   ```

4. Open `http://localhost:5173` in your browser.

### Creating a Mirror

If you wish to create a live version of Parlens, please refer to the [Mirror Creation Document](MIRROR_CREATION.md) for detailed instructions.

**Note:** If you release this application under the name "Parlens", you must not make any changes to the source code.

## Login Methods

Parlens supports multiple ways to access the app:
- **Create a Nostr Account**: Generate a new keypair (nsec/npub) to have a permanent identity and sync data across devices.
- **Login with Existing Nostr**: Use your existing NSEC (stored locally encrypted).
- **Burner Account**: Create a temporary guest account for a single session. Perfect for testing purposes or one-time usage.

## Attribution

Parlens is built on the shoulders of giants. Special thanks to:

- **OpenStreetMap Contributors**: For map data and geocoding services.
- **Nostr Protocol**: For the decentralized, censorship-resistant communication layer.
- **MapLibre**: For powerful open-source mapping libraries.
- **Lucide React**: For the beautiful icon set.

## License

This project is licensed under the **GNU General Public License v3.0 (GPL-3.0)**. See the `LICENSE` file for details.
