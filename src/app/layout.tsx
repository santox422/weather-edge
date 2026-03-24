import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'WEATHER EDGE — Polymarket Temperature Analytics Terminal',
  description: 'Professional Bloomberg-style forecast analysis terminal for Polymarket weather contracts. Live WebSocket prices, GFS, ECMWF, ensemble spread, CRPS calibration.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700;800&display=swap"
          rel="stylesheet"
        />
      </head>
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
