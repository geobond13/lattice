import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "LATTICE · Self-servicing orbital compute",
  description:
    "A modular orbital data center whose servicing robot reasons. Muse diagnoses, inspects and proposes; a deterministic envelope decides what runs.",
  icons: { icon: "/icon.svg" },
  openGraph: {
    title: "LATTICE · Self-servicing orbital compute",
    description: "12 modules. 1 robot. No one on console.",
    images: ["/og.svg"],
  },
};

export const viewport: Viewport = {
  themeColor: "#05070b",
  colorScheme: "dark",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full bg-bg text-ink">{children}</body>
    </html>
  );
}
