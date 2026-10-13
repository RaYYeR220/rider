import type { Metadata, Viewport } from "next";
import { Azeret_Mono, Bodoni_Moda, Manrope } from "next/font/google";
import { Providers } from "./providers";
import { Nav } from "@/components/Nav";
import { Footer } from "@/components/Footer";
import "./globals.css";

const bodoni = Bodoni_Moda({ subsets: ["latin"], axes: ["opsz"], variable: "--font-bodoni", display: "swap" });
const manrope = Manrope({ subsets: ["latin"], variable: "--font-manrope", display: "swap" });
const azeret = Azeret_Mono({ subsets: ["latin"], variable: "--font-azeret", display: "swap" });

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "https://rider-cover.vercel.app"),
  title: { default: "Rider — cover that rides with your deposit", template: "%s · Rider" },
  description:
    "Parametric cover for USDC deposits on Arc. Bought in the same transaction as the deposit, paid by the contract when an on-chain trigger proves the loss.",
  openGraph: {
    title: "Rider — paid on proof, not on request",
    description: "Parametric cover for USDC deposits on Arc, live on mainnet.",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#120f1c",
  colorScheme: "dark",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${bodoni.variable} ${manrope.variable} ${azeret.variable}`}>
      <body>
        <div className="tex-grid" aria-hidden />
        <Providers>
          <Nav />
          {children}
          <Footer />
        </Providers>
        <div className="tex-frame" aria-hidden />
        <div className="tex-grain" aria-hidden />
      </body>
    </html>
  );
}
