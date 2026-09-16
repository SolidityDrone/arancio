import { Link, NavLink } from "react-router-dom";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";

export function Nav() {
  return (
    <header className="nav">
      <div className="nav-bar">
        <Link to="/" className="brand">
          DivStrip<span>_</span>
        </Link>
        <nav className="nav-links">
          <NavLink to="/" end>
            Overview
          </NavLink>
          <NavLink to="/app">Strip desk</NavLink>
          <NavLink to="/dashboard">Dashboard</NavLink>
        </nav>
        <WalletMultiButton />
      </div>
    </header>
  );
}
