import type { Metadata, Viewport } from "next";
import { Lexend } from "next/font/google";
import "./globals.css";

const lexend = Lexend({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-lexend",
  display: "swap",
});

export const metadata: Metadata = {
  title: "AuraRead AI — Vision to Accessible Text",
  description:
    "AuraRead AI is an assistive document formatting tool that turns a photo of printed text into clean, dyslexia-friendly, readable and speakable text.",
};

export const viewport: Viewport = {
  themeColor: "#020617",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={lexend.variable}>
      <body className="font-lexend antialiased">
        {/* Compliance banner — AuraRead is a document formatting utility, not a
            medical, clinical or diagnostic product. */}
        <div
          data-compliance-banner
          className="border-b border-slate-800/80 bg-slate-900/60 px-4 py-2 text-center text-[11px] leading-snug text-slate-400 sm:text-xs"
        >
          <span className="font-semibold text-slate-300">
            AuraRead AI is an assistive document formatting tool.
          </span>{" "}
          It re-types the text you photograph so it is easier to read. It does
          not diagnose, interpret or advise on any medical condition.
        </div>
        {children}
      </body>
    </html>
  );
}
