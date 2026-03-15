import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { RegistryTopbar } from "@/components/layout/registry-topbar";
import "./globals.css";
import { RegistrySessionProvider } from "@/lib/registry-session";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Ekairos Registry | Landing and Showcase",
  description:
    "Standalone registry website for Ekairos UI components. Browse showcase cards, docs, and CLI install endpoints ready for Vercel deployment.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <RegistrySessionProvider>
          <RegistryTopbar />
          <div className="pt-11">{children}</div>
        </RegistrySessionProvider>
      </body>
    </html>
  );
}
