import { ThemeSwitcher } from "@/components/theme-switcher";
import { ServiceWorkerRegister } from "@/components/ServiceWorkerRegister";
import { Geist } from "next/font/google";
import { ThemeProvider } from "next-themes";
import Link from "next/link";
import Image from "next/image";
import 'leaflet/dist/leaflet.css';
import 'leaflet-defaulticon-compatibility/dist/leaflet-defaulticon-compatibility.webpack.css';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';
import "./globals.css";
import { Analytics } from '@vercel/analytics/react';
import { Metadata, Viewport } from 'next';

const defaultUrl = process.env.VERCEL_URL
  ? `https://${process.env.VERCEL_URL}`
  : 'http://localhost:3000';

export const metadata: Metadata = {
  metadataBase: new URL(defaultUrl),
  title: "Toilet Radar",
  description: "Find nearby public toilets",
  icons: {
    icon: '/icon-192.png',
    apple: '/apple-touch-icon.png',
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Toilet Radar',
  },
  openGraph: {
    title: 'Toilet Radar',
    description: 'Find nearby public toilets',
    url: defaultUrl,
    siteName: 'Toilet Radar',
    images: [
      {
        url: '/icon-512.png',
        width: 512,
        height: 512,
      },
    ],
    locale: 'en_US',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Toilet Radar',
    description: 'Find nearby public toilets',
    images: ['/icon-512.png'],
  },
  verification: {
    google: 'VL1kTPtwgiok_KtpB3XKlQ1pyg6SvATpOFlujXpg1r4'
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#0f172a' },
  ],
};

const geist = Geist({ subsets: ['latin'] });

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={geist.className} suppressHydrationWarning>
      <body className="bg-background text-foreground">
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          {/* h-dvh (not vh) tracks the collapsing mobile browser chrome, so the
              map is always exactly full-bleed with no page scroll. */}
          <main className="h-dvh flex flex-col">
            <nav className="relative z-10 w-full flex justify-center border-b border-b-foreground/10 h-14 shrink-0 bg-background">
              <div className="w-full max-w-5xl flex justify-between items-center p-3 px-5 text-sm">
                <Link href={"/"} className="flex items-center gap-2 font-semibold">
                  <Image
                    src="/icon-192.png"
                    alt="Toilet Radar logo"
                    width={28}
                    height={28}
                  />
                  Toilet Radar
                </Link>

                <div className="flex gap-4 items-center">
                  <ThemeSwitcher />
                </div>
              </div>
            </nav>

            <div className="flex-1 min-h-0 w-full">
              {children}
            </div>

            <footer className="hidden sm:flex w-full border-t border-t-foreground/10 px-8 py-2 flex-row items-center justify-center gap-2 text-center text-xs bg-background shrink-0">
              <p>
                Made with ❤️ by{" "}
                <a
                  href="https://github.com/peterbonnesoeur"
                  target="_blank"
                  className="font-bold hover:underline"
                  rel="noreferrer"
                >
                  Maxime Bonnesoeur
                </a>
                {" "}· Data ©{" "}
                <a
                  href="https://www.openstreetmap.org/copyright"
                  target="_blank"
                  className="hover:underline"
                  rel="noreferrer"
                >
                  OpenStreetMap
                </a>
              </p>
            </footer>
          </main>
        </ThemeProvider>
        <ServiceWorkerRegister />
        <Analytics />
      </body>
    </html>
  );
}
