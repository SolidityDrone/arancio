import { Link } from "react-router-dom";
import { Nav } from "../components/Nav";

export function LandingPage() {
  return (
    <div className="shell">
      <Nav />
      <section className="hero">
        <div className="eyebrow">◆ Stocklana · xStocks structured products</div>
        <h1>
          Split the stock.
          <br />
          Trade the <em>dividend</em>.
        </h1>
        <p className="hero-lead">
          DivStrip wraps an xStock into Principal (PT) and Yield (YT) tokens for a
          frozen corporate-action window — priced from the on-chain CA registry,
          not a live guess.
        </p>
        <div className="cta-row">
          <Link className="btn btn-primary" to="/app">
            Open strip desk →
          </Link>
          <a className="btn btn-ghost" href="#how">
            How the split works
          </a>
        </div>
        <div className="stats">
          <div className="stat">
            <div className="label">◆ Product</div>
            <div className="value">PT / YT</div>
          </div>
          <div className="stat">
            <div className="label">◆ Oracle</div>
            <div className="value">CA registry</div>
          </div>
          <div className="stat">
            <div className="label">◆ Coupon</div>
            <div className="value">1 − Yₛ/Yₜ</div>
          </div>
          <div className="stat">
            <div className="label">◆ Network</div>
            <div className="value">Solana</div>
          </div>
        </div>
      </section>

      <section className="section" id="how">
        <h2>How the split works</h2>
        <p className="lead">
          Same idea as TradFi dividend strips and ERC-8056 — except the calendar
          lives on Solana and CRE keeps it fresh from xStocks v2.
        </p>
        <div className="flow">
          <div className="flow-step">
            <div className="n">01 — Wrap</div>
            <h3>Lock a window</h3>
            <p>
              Deposit xStock. DivStrip reads{" "}
              <code>current_yield_nonce</code>, sets{" "}
              <code>target = start + N</code>, and mints PT + YT 1:1 into escrow.
            </p>
          </div>
          <div className="flow-step">
            <div className="n">02 — Trade</div>
            <h3>Separate risks</h3>
            <p>
              Keep YT if you want the next coupons. Sell PT to someone who wants
              equity beta without dividend noise — or the reverse.
            </p>
          </div>
          <div className="flow-step">
            <div className="n">03 — Redeem</div>
            <h3>Frozen coupon</h3>
            <p>
              After the window matures, capital redeems{" "}
              <code>Yₛ/Yₜ</code> of notional; yield redeems{" "}
              <code>1 − Yₛ/Yₜ</code>. Late YT never pays the live multiplier.
            </p>
          </div>
        </div>
      </section>

      <section className="section">
        <h2>Why PT and YT</h2>
        <p className="lead">
          Use cases that only make sense once corporate actions are on-chain.
        </p>
        <div className="usecases">
          <article className="usecase">
            <div className="tag">Desk</div>
            <div>
              <h3>Dividend strip market</h3>
              <p>
                Price the next KOx coupons as a clean YT. Hedge or harvest income
                without selling the stock narrative.
              </p>
            </div>
          </article>
          <article className="usecase">
            <div className="tag">Treasury</div>
            <div>
              <h3>Clean equity collateral</h3>
              <p>
                Hold PT for mark-to-market exposure. Peel YT and sell it for
                cashflow while the capital leg stays intact.
              </p>
            </div>
          </article>
          <article className="usecase">
            <div className="tag">Relative value</div>
            <div>
              <h3>Implied vs fair coupon</h3>
              <p>
                Registry fair coupon is{" "}
                <code>1 − cum_y(start)/cum_y(target)</code>. If YT trades rich or
                cheap, that’s a dividend-cut / surprise view.
              </p>
            </div>
          </article>
          <article className="usecase">
            <div className="tag">Calendar</div>
            <div>
              <h3>Window spreads</h3>
              <p>
                Alice wraps (0→2), Bob wraps (1→2). Same maturity, different
                frozen coupons — the ERC-8056 worked example, live on xStocks.
              </p>
            </div>
          </article>
          <article className="usecase">
            <div className="tag">Meteora</div>
            <div>
              <h3>YT launch on DBC → DAMM v2</h3>
              <p>
                Each yield window gets a Dynamic Bonding Curve listing seeded
                from the registry fair coupon, then graduates to DAMM v2 for
                lasting liquidity — equity-strip discovery, not memecoin meta.
              </p>
            </div>
          </article>
        </div>
      </section>

      <footer className="footer">
        <span>Built for Stocklana · Solana tokenized equities</span>
        <Link to="/app">Launch the desk →</Link>
      </footer>
    </div>
  );
}
