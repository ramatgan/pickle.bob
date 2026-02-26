import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Pickleball Matchmaker",
  description: "Session match recommendations with soft fairness + balance"
};

export default function RootLayout({
  children
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
