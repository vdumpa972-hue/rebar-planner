import type { Metadata } from "next";
import "./globals.css";
import { AuthProvider } from "@/contexts/AuthContext";
import SeoStructuredData from "@/components/SeoStructuredData";

export const metadata: Metadata = {
  metadataBase: new URL("https://rebar-planner.vercel.app"),
  title: {
    default: "Rebar Planner | Rebar Cut Lists and Foundation Planning",
    template: "%s | Rebar Planner",
  },
  description: "Plan foundation rebar, calculate bar quantities, create cut and bend schedules, reduce stock waste, and generate shop-ready material lists from project dimensions.",
  keywords: [
    "rebar calculator",
    "rebar cut list",
    "rebar schedule",
    "foundation rebar planner",
    "rebar bending schedule",
    "rebar waste optimization"
  ],
  applicationName: "Rebar Planner",
  category: "business",
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    url: "/",
    siteName: "Rebar Planner",
    title: "Rebar Planner | Rebar Cut Lists and Foundation Planning",
    description: "Plan foundation rebar, calculate bar quantities, create cut and bend schedules, reduce stock waste, and generate shop-ready material lists from project dimensions.",
  },
  twitter: {
    card: "summary",
    title: "Rebar Planner | Rebar Cut Lists and Foundation Planning",
    description: "Plan foundation rebar, calculate bar quantities, create cut and bend schedules, reduce stock waste, and generate shop-ready material lists from project dimensions.",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1 },
  },
  icons: {
    icon: "/favicon.ico",
    apple: "/apple-touch-icon.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        <SeoStructuredData /><AuthProvider>{children}</AuthProvider></body>
    </html>
  );
}
