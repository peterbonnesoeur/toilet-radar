import DeployButton from "@/components/deploy-button";
import { EnvVarWarning } from "@/components/env-var-warning";
import HeaderAuth from "@/components/header-auth";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { hasEnvVars } from "@/utils/supabase/check-env-vars";
import { Geist } from "next/font/google";
import { ThemeProvider } from "next-themes";
import Link from "next/link";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Menu } from "lucide-react";
import 'leaflet/dist/leaflet.css';
import 'leaflet-defaulticon-compatibility/dist/leaflet-defaulticon-compatibility.webpack.css';
import "./globals.css";
import { Analytics } from '@vercel/analytics/react';
import { Metadata } from 'next';

const defaultUrl = process.env.VERCEL_URL
  ? `https://${process.env.VERCEL_URL}`
  : 'http://localhost:3000';

export const metadata: Metadata = {
  metadataBase: new URL(defaultUrl),
  title: "Toilet Radar",
  description: "Find nearby public toilets",
  icons: {
    icon: '/logo.png',
  },
  openGraph: {
    title: 'Toilet Radar',
    description: 'Find nearby public toilets',
    url: defaultUrl,
    siteName: 'Toilet Radar',
    images: [
      {
        url: '/logo.png',
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
    images: ['/logo.png'],
  },
  verification: {
    google: 'VL1kTPtwgiok_KtpB3XKlQ1pyg6SvATpOFlujXpg1r4'
  },
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
          <main className="min-h-screen flex flex-col items-center">
            <nav className="relative z-10 w-full flex justify-center border-b border-b-foreground/10 h-16 bg-background">
              <div className="w-full max-w-5xl flex justify-between items-center p-3 px-5 text-sm">
                <Link href={"/"} className="flex items-center gap-2 font-semibold">
                  <Image
                    src="/logo.png"
                    alt="Toilet Radar Logo"
                    width={28}
                    height={28}
                  />
                  Toilet Radar
                </Link>

                <div className="flex gap-4 items-center">
                  {/* This is the sign up button */}
                  {/* <Button variant="outline">Sign Up</Button> */}
                  {/* {!hasEnvVars ? <EnvVarWarning /> : <HeaderAuth />} */}
                  <ThemeSwitcher />
                </div>
              </div>
            </nav>

            <div className="flex-1 w-full flex flex-col items-center">
              {children}
            </div>

            <footer 
              className="w-full border-t border-t-foreground/10 px-8 py-4 flex flex-col justify-center text-center text-xs bg-background"
            >
              <p>
                Powered by{" "}
                <a
                  href="https://supabase.com/?utm_source=create-next-app&utm_medium=template&utm_term=nextjs"
                  target="_blank"
                  className="font-bold hover:underline"
                  rel="noreferrer"
                >
                  Supabase
                </a>{" "}
                &{" "}
                <a
                  href="https://leafletjs.com/"
                  target="_blank"
                  className="font-bold hover:underline"
                  rel="noreferrer"
                >
                  Leaflet
                </a>
              </p>
              
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
              </p>
            </footer>
          </main>
        </ThemeProvider>
        <Analytics />
      </body>
    </html>
  );
}