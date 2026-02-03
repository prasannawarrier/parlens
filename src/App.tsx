import React, { useState } from 'react';
import { useAuth } from './contexts/AuthContext';
import { LandingPage } from './pages/LandingPage';
import { QRScanPage } from './pages/QRScanPage';
import { Shield, UserPlus, Key, ChevronRight, ChevronDown } from 'lucide-react';
import { nip19 } from 'nostr-tools';

const Login: React.FC = () => {
  const { login } = useAuth();
  const [nsec, setNsec] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [view, setView] = useState<'landing' | 'nsec' | 'setup' | 'backup'>('landing');
  const [newUsername, setNewUsername] = useState('');
  const [generatedKeys, setGeneratedKeys] = useState<{ npub: string; nsec: string } | null>(null);

  const handleLogin = async (method: 'extension' | 'nsec') => {
    setIsLoading(true);
    setError('');
    try {
      await login(method, method === 'nsec' ? nsec : undefined);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreateAccount = () => {
    setView('setup');
  };

  const handleFinishSetup = async () => {
    if (!newUsername.trim()) {
      setError('Please enter a username');
      return;
    }
    setIsLoading(true);
    try {
      // Import here to avoid top-level import issues
      const { generateSecretKey, getPublicKey } = await import('nostr-tools/pure');

      // Convert bytes to hex string
      const toHex = (bytes: Uint8Array) => Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');

      // Generate keys
      const privateKey = generateSecretKey();
      const publicKey = getPublicKey(privateKey);

      // Store keys
      localStorage.setItem('parlens_privkey', toHex(privateKey));
      localStorage.setItem('parlens_pubkey', publicKey);
      localStorage.setItem('parlens_pending_username', newUsername);

      // Generate bech32 encoded keys for display
      const npubKey = nip19.npubEncode(publicKey);
      const nsecKey = nip19.nsecEncode(privateKey);

      setGeneratedKeys({ npub: npubKey, nsec: nsecKey });
      setView('backup');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCompleteSetup = async () => {
    setIsLoading(true);
    try {
      const pendingUsername = localStorage.getItem('parlens_pending_username');
      await login('create', undefined, pendingUsername || newUsername);
      localStorage.removeItem('parlens_pending_username');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className={`h-[100dvh] bg-zinc-50 dark:bg-black p-6 text-zinc-900 dark:text-white text-center flex flex-col items-center justify-center transition-colors duration-300 relative ${view === 'backup' ? 'overflow-y-auto' : 'overflow-hidden'}`} style={{ paddingBottom: 'max(1.5rem, env(safe-area-inset-bottom))' }}>
      <div className="w-full max-w-sm space-y-12 animate-in fade-in zoom-in-95 duration-700">
        <div className="space-y-4">
          <img
            src={`${import.meta.env.BASE_URL}pwa-512x512.png`}
            alt="Parlens"
            className="mx-auto h-24 w-24 rounded-[22%] shadow-2xl shadow-[#007AFF]/20"
          />
          <h1 className="text-5xl font-extrabold tracking-tighter text-zinc-900 dark:text-white">Parlens</h1>
          {/* UPDATED: User requested "Decentralised Parking Management" */}
          <p className="text-sm font-medium text-zinc-500 dark:text-white/40 tracking-tight">Decentralised Parking Management</p>
        </div>

        <div className="space-y-4">
          {view === 'landing' ? (
            <>
              <button
                onClick={handleCreateAccount}
                disabled={isLoading}
                className="w-full h-16 rounded-3xl bg-white dark:bg-white text-black font-bold text-lg shadow-xl shadow-black/5 dark:shadow-none active:scale-95 transition-all flex items-center justify-center gap-3 border border-black/5 dark:border-transparent"
              >
                {isLoading ? 'Creating...' : (
                  <>
                    <UserPlus size={20} strokeWidth={3} />
                    Create a New Account
                  </>
                )}
              </button>

              <button
                onClick={() => setView('nsec')}
                disabled={isLoading}
                className="w-full h-16 rounded-3xl bg-[#007AFF] text-white font-bold text-lg shadow-lg shadow-[#007AFF]/20 active:scale-95 transition-all flex items-center justify-center gap-2"
              >
                <Key size={18} />
                Login with Nostr Account
              </button>
            </>
          ) : view === 'setup' ? (
            <div className="space-y-4 pt-4 animate-in slide-in-from-right-4">
              <div className="text-center pb-2">
                <h3 className="text-xl font-bold text-zinc-900 dark:text-white">Pick a Username</h3>
                <p className="text-zinc-500 dark:text-white/40 text-sm">This will be your identity on Nostr</p>
              </div>
              <input
                type="text"
                placeholder="Username"
                value={newUsername}
                onChange={(e) => setNewUsername(e.target.value)}
                className="w-full h-16 rounded-3xl bg-white dark:bg-zinc-900 border border-black/5 dark:border-white/10 px-6 text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#007AFF] placeholder:text-zinc-400 dark:placeholder:text-white/20 shadow-sm dark:shadow-none"
                autoFocus
              />
              <p className="text-xs text-zinc-400 dark:text-white/30 text-left leading-relaxed mt-2 pl-2">
                Your username can be any combination of letters, numbers or special characters and doesn’t have to be unique.
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setView('landing')}
                  className="h-16 px-6 rounded-3xl bg-white dark:bg-zinc-900 text-zinc-900 dark:text-white border border-black/5 dark:border-white/10 font-bold shadow-sm dark:shadow-none"
                >
                  Back
                </button>
                <button
                  onClick={handleFinishSetup}
                  disabled={isLoading || !newUsername}
                  className="flex-1 h-16 rounded-3xl bg-[#007AFF] text-white font-bold shadow-lg active:scale-95 transition-all"
                >
                  {isLoading ? 'Creating...' : 'Continue'}
                </button>
              </div>
            </div>
          ) : view === 'backup' ? (
            <div className="space-y-6 pt-4 animate-in slide-in-from-right-4 text-left">
              <div className="text-center pb-2">
                <h3 className="text-xl font-bold text-zinc-900 dark:text-white">🎉 Account Created!</h3>
                <p className="text-zinc-500 dark:text-white/40 text-sm mt-1">Backup your keys before continuing</p>
              </div>

              <div className="space-y-4">
                {/* Header Removed */}
                <div className="space-y-0.5 rounded-[2rem] overflow-hidden bg-white dark:bg-white/[0.03] border border-black/5 dark:border-white/10 shadow-sm dark:shadow-none">
                  <div
                    className="p-5 flex items-center justify-between transition-colors cursor-pointer active:bg-black/5 dark:active:bg-white/10"
                    onClick={() => {
                      if (generatedKeys) {
                        navigator.clipboard.writeText(generatedKeys.npub);
                        alert('Copied to clipboard');
                      }
                    }}
                  >
                    <div className="flex items-center gap-3">
                      <div className="p-2.5 rounded-xl bg-blue-500/10 dark:bg-blue-500/20 text-blue-600 dark:text-blue-400"><Key size={20} /></div>
                      <span className="font-semibold text-sm text-zinc-900 dark:text-white">Copy Nostr Public Key (Npub)</span>
                    </div>
                    <ChevronRight size={18} className="text-zinc-400 dark:text-white/20" />
                  </div>
                  <div className="h-[1px] bg-black/5 dark:bg-white/5 mx-4" />
                  <div
                    className="p-5 flex items-center justify-between transition-colors cursor-pointer active:bg-black/5 dark:active:bg-white/10"
                    onClick={() => {
                      if (generatedKeys) {
                        navigator.clipboard.writeText(generatedKeys.nsec);
                        alert('Copied to clipboard');
                      }
                    }}
                  >
                    <div className="flex items-center gap-3">
                      <div className="p-2.5 rounded-xl bg-red-500/10 dark:bg-red-500/20 text-red-600 dark:text-red-500"><Shield size={20} /></div>
                      <span className="font-semibold text-sm text-zinc-900 dark:text-white">Copy Nostr Secret Key (Nsec)</span>
                    </div>
                    <ChevronRight size={18} className="text-zinc-400 dark:text-white/20" />
                  </div>
                </div>
                <p className="text-xs text-zinc-400 dark:text-white/30 mt-2 ml-2 leading-relaxed text-left">
                  Your keys manage your identity on Nostr. Npub is your unique public identifier. It is used to link your data to your account. Nsec is the password that proves your ownership of the account. It validates and encrypts your data.
                </p>
              </div>

              {/* Onboarding Help Content */}
              <div className="space-y-6 pt-6 border-t border-black/5 dark:border-white/10">
                <div className="space-y-2">
                  <h3 className="text-lg font-bold text-zinc-900 dark:text-white">Getting Started</h3>
                  <p className="text-sm text-zinc-500 dark:text-white/60">Follow these steps to get the most out of Parlens.</p>
                </div>

                {/* New Parking Seekers Section */}
                <div className="space-y-4 text-sm text-zinc-600 dark:text-white/60 leading-relaxed">
                  <div>
                    <h4 className="font-bold text-zinc-900 dark:text-white text-base mb-4">Parking Seekers</h4>
                    <p className="mb-4">
                      <strong className="text-zinc-900 dark:text-white block mb-1">1. Select Vehicle Type</strong>
                      Use the vertical toggle to switch between Bicycle 🚲, Motorcycle 🏍️, or Car 🚗. Your vehicle type determines what parking spots you see on the map.
                    </p>

                    <p className="mb-4">
                      <strong className="text-zinc-900 dark:text-white block mb-1">2. Find Parking</strong>
                      Click the blue search button to find parking around you or plan ahead by searching for parking near your destination. Click the search for parking bubble at the top of your screen to find parking near your destination and click the blue search button when you are nearby to refresh parking results in real-time.
                    </p>

                    <p className="mb-4">
                      <strong className="text-zinc-900 dark:text-white block mb-1">3. Mark Your Spot</strong>
                      Once you find a spot, click the amber parking location button to mark your parked location and start your session. Click the session active bubble to centre the map on your parking marker at any time during the session.
                    </p>

                    <p className="mb-4">
                      <strong className="text-zinc-900 dark:text-white block mb-1">4. Log Your Session</strong>
                      When you’re ready to leave, click the green vehicle button to remove the marker, report the fees and log the session in your parking history.
                    </p>

                    <p>
                      <strong className="text-zinc-900 dark:text-white block mb-1">5. Share Parking Reports (Optional)</strong>
                      Anonymously report parking details to help other users know where to find parking. The opt-in switch for this feature is available in the parking areas section on the profile page. Once opted-in, you may opt-out at any time.
                    </p>
                  </div>

                  {/* Providers Section */}
                  <div className="mt-8 pt-4">
                    <h4 className="font-bold text-zinc-900 dark:text-white text-base mb-4">Parking Service Providers</h4>

                    <p className="mb-4">
                      <strong className="text-zinc-900 dark:text-white block mb-1">1. Listed Parking</strong>
                      Users who oversee one or more parking spots can create a listing to simplify spot discovery and management. Click the parking services button (‽) and select listed parking.
                      <br /><br />
                      Click the ‘+’ button to create a listing and provide the details as requested in the form to create one or more online spots to match your real world location.
                    </p>

                    <p>
                      <strong className="text-zinc-900 dark:text-white block mb-1">2. Valet Parking (Coming Soon)</strong>
                      Users who park for others can enable valet mode to manage multiple parking sessions at the same time. Click the parking services button (‽) and select valet parking to get started.
                      <br /><br />
                      Click the ‘+’ button to create a new valet session. Ask your clients to scan the QR code using the Parlens app to see the parking location and let you know when they’re ready to leave.
                      <br /><br />
                      Valet parking will be added after we find a full-stack developer to join the project. Reach out on GitHub if you're interested.
                    </p>
                  </div>

                  {/* Privacy & License - Static Headers */}
                  <div className="mt-6 pt-4 space-y-6">
                    <div>
                      <h4 className="font-bold text-zinc-900 dark:text-white text-base mb-2">User Privacy</h4>
                      <p className="mb-4">
                        Parlens does not collect or share any personal data. Parking history and saved routes are encrypted by your keys and only accessible by you. If you ever feel like your privacy is compromised, delete your account, abandon your keys and create a new account.
                      </p>
                    </div>

                    <div>
                      <h4 className="font-bold text-zinc-900 dark:text-white text-base mb-2">License</h4>
                      <p>
                        This project is licensed under the GNU General Public License v3.0.
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              <button
                onClick={handleCompleteSetup}
                disabled={isLoading}
                className="w-full h-16 rounded-3xl bg-[#007AFF] text-white font-bold shadow-lg shadow-[#007AFF]/20 active:scale-95 transition-all flex items-center justify-center gap-2"
              >
                {isLoading ? 'Starting...' : 'Start Using Parlens'}
              </button>
            </div>
          ) : (
            <div className="space-y-4 pt-4 animate-in slide-in-from-bottom-4">
              <input
                type="password"
                placeholder="Paste your nsec..."
                value={nsec}
                onChange={(e) => setNsec(e.target.value)}
                className="w-full h-16 rounded-3xl bg-white dark:bg-zinc-900 border border-black/5 dark:border-white/10 px-6 text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#007AFF] placeholder:text-zinc-400 dark:placeholder:text-white/20 shadow-sm dark:shadow-none"
                autoFocus
              />
              <div className="flex gap-3">
                <button
                  onClick={() => setView('landing')}
                  className="h-16 px-6 rounded-3xl bg-white dark:bg-zinc-900 text-zinc-900 dark:text-white border border-black/5 dark:border-white/10 font-bold shadow-sm dark:shadow-none"
                >
                  Back
                </button>
                <button
                  onClick={() => handleLogin('nsec')}
                  disabled={isLoading || !nsec}
                  className="flex-1 h-16 rounded-3xl bg-[#007AFF] text-white font-bold shadow-lg active:scale-95 transition-all"
                >
                  {isLoading ? 'Decrypting...' : 'Login with Key'}
                </button>
              </div>
            </div>
          )}

          {error && (
            <div className="p-4 rounded-3xl bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-500 text-xs font-bold text-center animate-in fade-in slide-in-from-top-2">
              {error}
            </div>
          )}

          {/* Add to Homescreen Section */}
          <div className="space-y-3 pt-6 border-t border-black/5 dark:border-white/10">
            <h3 className="text-center font-bold text-zinc-500 dark:text-white/70 text-sm">Add to your homescreen for fullscreen experience</h3>
            {/* Android */}
            <div className="rounded-2xl bg-white dark:bg-white/5 overflow-hidden shadow-sm dark:shadow-none border border-black/5 dark:border-transparent">
              <button onClick={() => {
                const el = document.getElementById('login-android-guide');
                el?.classList.toggle('hidden');
              }} className="w-full flex items-center justify-between p-4 font-bold text-sm text-left text-zinc-800 dark:text-white/80 transition-colors" style={{ WebkitTapHighlightColor: 'transparent' }}>
                <span>Using Browser Menu (Android)</span>
                <ChevronDown size={16} className="text-zinc-400 dark:text-white/50" />
              </button>
              <div id="login-android-guide" className="hidden p-4 pt-0 text-xs text-zinc-600 dark:text-white/60 space-y-2 text-left">
                <p className="font-semibold text-zinc-900 dark:text-white/80">Chrome & Brave:</p>
                <ol className="list-decimal pl-5 space-y-1">
                  <li>Tap menu button (three dots)</li>
                  <li>Tap <strong>Add to Home screen</strong></li>
                  <li>Tap <strong>Add</strong> to confirm</li>
                </ol>
                <p className="font-semibold text-zinc-900 dark:text-white/80 mt-3">Firefox:</p>
                <ol className="list-decimal pl-5 space-y-1">
                  <li>Tap menu button (three dots)</li>
                  <li>Tap <strong>Install</strong></li>
                </ol>
              </div>
            </div>

            {/* iOS */}
            <div className="rounded-2xl bg-white dark:bg-white/5 overflow-hidden shadow-sm dark:shadow-none border border-black/5 dark:border-transparent">
              <button onClick={() => {
                const el = document.getElementById('login-ios-guide');
                el?.classList.toggle('hidden');
              }} className="w-full flex items-center justify-between p-4 font-bold text-sm text-left text-zinc-800 dark:text-white/80 transition-colors" style={{ WebkitTapHighlightColor: 'transparent' }}>
                <span>Using Share Button (iOS)</span>
                <ChevronDown size={16} className="text-zinc-400 dark:text-white/50" />
              </button>
              <div id="login-ios-guide" className="hidden p-4 pt-0 text-xs text-zinc-600 dark:text-white/60 space-y-2 text-left">
                <ol className="list-decimal pl-5 space-y-1">
                  <li>Tap the <strong className="text-zinc-900 dark:text-white/80">Share</strong> button in Safari menu bar.</li>
                  <li>Scroll down and tap <strong className="text-zinc-900 dark:text-white/80">Add to Home Screen</strong>.</li>
                  <li>Launch Parlens from your home screen.</li>
                </ol>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

const App: React.FC = () => {
  const { pubkey, refreshConnections } = useAuth();
  const [currentPage, setCurrentPage] = useState<'home' | 'scan'>('home');
  const [pendingScanCode, setPendingScanCode] = useState<string | null>(null);
  const [isProcessingScan, setIsProcessingScan] = useState(false);

  // Global visibility change handler for iOS PWA background suspension
  React.useEffect(() => {
    let lastHiddenTime = 0;

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        lastHiddenTime = Date.now();
        console.log('[App] Backgrounded at', new Date().toISOString());
      } else if (document.visibilityState === 'visible' && lastHiddenTime > 0) {
        const hiddenDuration = Date.now() - lastHiddenTime;
        console.log('[App] Foregrounded after', hiddenDuration, 'ms');

        // If backgrounded for more than 5 seconds, trigger global refresh
        if (hiddenDuration > 5000) {
          console.log('[App] Dispatching visibility-refresh event');
          window.dispatchEvent(new Event('visibility-refresh'));
        }
      }
    };

    // Handle iOS bfcache restoration
    const handlePageShow = (event: PageTransitionEvent) => {
      if (event.persisted) {
        console.log('[App] Page restored from bfcache, triggering refresh');
        window.dispatchEvent(new Event('visibility-refresh'));
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pageshow', handlePageShow);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('pageshow', handlePageShow);
    };
  }, []);

  if (!pubkey) {
    return <Login />;
  }

  // Processing Overlay (during relay refresh after scan)
  if (isProcessingScan) {
    return (
      <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-gray-50 dark:bg-black transition-colors duration-300 animate-in fade-in">
        <div className="flex flex-col items-center gap-4">
          <div className="w-8 h-8 rounded-full border-4 border-green-500/20 border-t-green-500 animate-spin" />
          <p className="text-sm font-semibold text-zinc-400 dark:text-white/40 tracking-tight">Verifying...</p>
        </div>
      </div>
    );
  }

  // QR Scan Page
  if (currentPage === 'scan') {
    return (
      <QRScanPage
        onCancel={() => {
          refreshConnections();
          setCurrentPage('home');
        }}
        onScan={async (code) => {
          // 1. Show processing state immediately (stops camera, unmounts scanner)
          setIsProcessingScan(true);

          // 2. Refresh connections and WAIT for them to be healthy
          // This ensures LandingPage gets a fresh, connected pool
          try {
            await refreshConnections();
          } catch (e) {
            console.warn('Connection refresh failed, proceeding anyway:', e);
          }

          // 3. Set code and switch to home
          setPendingScanCode(code);
          setCurrentPage('home');

          // 4. Hide processing state
          setIsProcessingScan(false);
        }}
        isProcessing={isProcessingScan}
      />
    );
  }

  // Landing Page (Home)
  return (
    <LandingPage
      onRequestScan={() => setCurrentPage('scan')}
      initialScannedCode={pendingScanCode}
      onScannedCodeConsumed={() => setPendingScanCode(null)}
    />
  );
};

export default App;
