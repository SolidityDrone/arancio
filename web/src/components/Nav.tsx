import { Link, NavLink } from "react-router-dom";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";

export function Nav() {
  return (
    <header className="nav">
      <Link to="/" className="brand">
        DivStrip<span>_</span>
      </Link>
      <nav className="nav-links">
        <NavLink to="/" end>
          Overview
        </NavLink>
        <NavLink to="/app">Strip desk</NavLink>
        <a
          href="https://hackathons.solana.com/hackathons/stocklana"
          target="_blank"
          rel="noreferrer"
        >
          Stocklana
        </a>
      </nav>
      <WalletMultiButton />
    </header>
  );
}
