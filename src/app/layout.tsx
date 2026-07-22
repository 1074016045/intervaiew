import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "IntervAIew — 面面具到",
  description: "Practice clearly. Answer confidently.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <header className="topbar">
          <div className="shell topbar-inner">
            <Link href="/" className="brand">
              IntervAIew <span className="muted">· 面面具到</span>
            </Link>
            <nav className="nav" aria-label="Primary navigation">
              <span className="practice-badge">Practice Mode</span>
              <Link href="/interviews/new">New practice</Link>
              <Link href="/history">History</Link>
              <Link href="/lab/transcript">Transcript Lab</Link>
            </nav>
          </div>
        </header>
        <main>
          <div className="shell">{children}</div>
        </main>
        <footer className="footer">
          <div className="shell">
            Practice-only software. Respect interview rules and obtain consent.
          </div>
        </footer>
      </body>
    </html>
  );
}
