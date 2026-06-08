import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Barbahra Prospecção",
  description: "Dashboard de campanhas de prospecção com Excel e WhatsApp."
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
