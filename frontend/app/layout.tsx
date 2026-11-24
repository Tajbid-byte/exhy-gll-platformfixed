import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "ExHyGLL — Explainable Vulnerability Intelligence",
  description: "A transparent C/C++ security review workspace inspired by the ExHyGLL research architecture.",
  applicationName: "ExHyGLL"
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
