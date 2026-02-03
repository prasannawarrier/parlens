/**
 * QR Scan Page - Full screen camera scanner
 * Separated from LandingPage to ensure clean lifecycle management
 */
import React, { useRef, useState, useEffect } from 'react';
import { X } from 'lucide-react';
import { Html5Qrcode } from 'html5-qrcode';

interface QRScanPageProps {
    onCancel: () => void;
    onScan: (code: string) => Promise<void> | void; // Allow async
    isProcessing?: boolean;
}

export const QRScanPage: React.FC<QRScanPageProps> = ({ onCancel, onScan, isProcessing = false }) => {
    const scannerRef = useRef<Html5Qrcode | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [isStarting, setIsStarting] = useState(true);
    const hasScannedRef = useRef(false);

    useEffect(() => {
        let isMounted = true;

        const startScanner = async () => {
            try {
                // Create scanner
                const scanner = new Html5Qrcode('qr-reader-element', { verbose: false });
                scannerRef.current = scanner;

                // Start with back camera
                await scanner.start(
                    { facingMode: 'environment' },
                    {
                        fps: 10,
                        qrbox: (viewfinderWidth, viewfinderHeight) => {
                            // Make qrbox square and centered
                            const minEdge = Math.min(viewfinderWidth, viewfinderHeight);
                            const qrboxSize = Math.floor(minEdge * 0.75);
                            return { width: qrboxSize, height: qrboxSize };
                        },
                        aspectRatio: 1.0,
                    },
                    (decodedText) => {
                        if (hasScannedRef.current) return;
                        hasScannedRef.current = true;

                        // Stop scanner then callback
                        scanner.stop().then(() => {
                            onScan(decodedText);
                        }).catch(console.error);
                    },
                    () => { /* Ignore scan errors */ }
                );

                if (isMounted) setIsStarting(false);
            } catch (err: any) {
                console.error('[QRScanPage] Camera error:', err);
                if (isMounted) {
                    setError(err.message || 'Failed to access camera');
                    setIsStarting(false);
                }
            }
        };

        // Delay to ensure DOM is ready
        const timer = setTimeout(startScanner, 150);

        return () => {
            isMounted = false;
            clearTimeout(timer);
            if (scannerRef.current) {
                scannerRef.current.stop().catch(() => { });
                scannerRef.current = null;
            }
        };
    }, [onScan]);

    const handleClose = async () => {
        if (scannerRef.current) {
            try {
                await scannerRef.current.stop();
            } catch (e) { /* Ignore */ }
            scannerRef.current = null;
        }
        onCancel();
    };

    if (isProcessing) {
        return null; // Don't render anything if processing (App.tsx shows the overlay, and this component will be unmounted shortly)
        // Actually, App.tsx unmounts this component when isProcessingScan becomes true, but we should handle the prop gracefully if it persists.
        // Wait, App.tsx DOES NOT unmount this immediately. It renders <QRScanPage isProcessing={true} /> while processing?
        // No, looking at App.tsx:
        /*
           if (isProcessingScan) { return <ProcessingOverlay ... /> }
           if (currentPage === 'scan') { return <QRScanPage ... /> }
        */
        // So when `isProcessingScan` is set to true, App.tsx re-renders and returns the ProcessingOverlay INSTEAD of QRScanPage.
        // So QRScanPage gets unmounted.
        // However, providing the prop allows us to show a local busy state if we wanted to, or disable inputs.
        // But since it unmounts, this prop might be ignored?
        // Let's look at the `App.tsx` logic again.
        // onScan -> setIsProcessingScan(true) -> State update -> App Re-renders -> ProcessingOverlay returned.
        // So QRScanPage unmounts.
        // BUT, the manual input handler below needs to be updated.
    }

    return (
        <div className="fixed inset-0 z-[9999] bg-black flex flex-col">
            {/* Close Button */}
            <button
                onClick={handleClose}
                className="absolute top-6 right-6 p-3 rounded-full bg-white/10 text-white z-20"
            >
                <X size={24} />
            </button>

            {/* Camera Container with CSS Cutout */}
            <div className="flex-1 flex items-center justify-center relative">
                {isStarting && (
                    <div className="absolute inset-0 flex items-center justify-center z-10">
                        <div className="text-white/60 text-sm animate-pulse">Starting camera...</div>
                    </div>
                )}

                {error ? (
                    <div className="p-6 bg-red-500/10 border border-red-500/30 rounded-2xl text-center">
                        <div className="text-red-400 font-bold mb-2">Camera Error</div>
                        <div className="text-red-300/80 text-sm mb-4">{error}</div>
                        <button onClick={handleClose} className="px-4 py-2 bg-red-500 text-white rounded-lg font-bold">
                            Go Back
                        </button>
                    </div>
                ) : (
                    <>
                        {/* The html5-qrcode container */}
                        <div
                            id="qr-reader-element"
                            className="w-full h-full"
                        />
                        {/* CSS Overlay for Custom Square Cutout - Overlaid on video */}
                        <div className="absolute inset-0 pointer-events-none">
                            {/* Top shade */}
                            <div className="absolute top-0 left-0 right-0 h-[20%] bg-black/60" />
                            {/* Bottom shade */}
                            <div className="absolute bottom-0 left-0 right-0 h-[20%] bg-black/60" />
                            {/* Left shade */}
                            <div className="absolute top-[20%] left-0 w-[12.5%] h-[60%] bg-black/60" />
                            {/* Right shade */}
                            <div className="absolute top-[20%] right-0 w-[12.5%] h-[60%] bg-black/60" />
                            {/* Center cutout border */}
                            <div className="absolute top-[20%] left-[12.5%] right-[12.5%] h-[60%] border-2 border-white/50 rounded-2xl" />
                        </div>
                    </>
                )}
            </div>

            {/* Bottom Text */}
            <div className="p-6 text-center shrink-0">
                <p className="text-white/60 text-sm">Point camera at a Parlens QR code</p>
                <button
                    onClick={async () => {
                        const code = prompt('Enter QR code manually:');
                        if (code) {
                            if (hasScannedRef.current) return;
                            hasScannedRef.current = true;

                            // Stop scanner cleanly before triggering onScan
                            if (scannerRef.current) {
                                try {
                                    await scannerRef.current.stop();
                                } catch { }
                                scannerRef.current = null;
                            }

                            // Call onScan - which triggers the App.tsx processing flow
                            onScan(code);
                        }
                    }}
                    className="mt-4 text-blue-400 text-sm font-bold"
                >
                    Enter code manually
                </button>
            </div>
        </div>
    );
};
