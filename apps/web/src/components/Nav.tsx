"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Connect } from "./Connect";
import styles from "./Nav.module.css";

const LINKS = [
  { href: "/markets", label: "Markets" },
  { href: "/protect", label: "Protect" },
  { href: "/underwrite", label: "Underwrite" },
  { href: "/policies", label: "Policies" },
  { href: "/drill", label: "Live drill" },
  { href: "/proof", label: "Proof" },
  { href: "/build", label: "Build" },
];

export function Nav() {
  const path = usePathname();
  return (
    <header className={styles.nav}>
      <Link href="/" className={styles.mark}>
        Rider
      </Link>
      <nav className={styles.links} aria-label="Main">
        {LINKS.map((l) => (
          <Link key={l.href} href={l.href} aria-current={path.startsWith(l.href) ? "page" : undefined}>
            {l.label}
          </Link>
        ))}
      </nav>
      <Connect />
    </header>
  );
}
