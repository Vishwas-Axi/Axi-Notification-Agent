import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Axi · Market Alert Center",
  description: "Live market alerts auto-drafted from public data & news, refined by AI — holidays, macro, IPO, and breaking news.",
  icons: { icon: "/axi-logo-red.svg" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
