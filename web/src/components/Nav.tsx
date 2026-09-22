"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ClientWalletButton } from "./ClientWalletButton";

function NavItem({
  href,
  end,
  children,
}: {
  href: string;
  end?: boolean;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const active = end ? pathname === href : pathname.startsWith(href);
  return (
    <Link href={href} className={active ? "active" : undefined} data-active={active}>
      {children}
    </Link>
  );
}

export function Nav() {
  return (
    <header className="nav">
      <div className="nav-bar">
        <Link href="/" className="brand">
          DivStrip<span>_</span>
        </Link>
        <nav className="nav-links">
          <NavItem href="/" end>
            Overview
          </NavItem>
          <NavItem href="/app">Strip desk</NavItem>
          <NavItem href="/dashboard">Dashboard</NavItem>
        </nav>
        <ClientWalletButton />
      </div>
    </header>
  );
}
