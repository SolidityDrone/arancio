import { Link } from "react-router-dom";
import { Nav } from "../components/Nav";
import { SceneBackdrop } from "../components/SceneBackdrop";
import { StockLogo } from "../components/StockLogo";
import { MARKETS } from "../lib/markets";

export function LandingPage() {
  return (
    <>
      <Nav />

      <section className="hero">
        <SceneBackdrop />
        <div className="shell hero-inner">
          <div className="hero-grid">
            <div className="hero-copy">
              <div className="eyebrow">◆ Stocklana · xStocks</div>
              <h1>
                Split the stock.
                <br />
                Trade the <em>dividend</em>.
              </h1>
              <p className="hero-lead">
                Wrap mega-cap xStocks into PT + YT for a frozen CA window — then
                list the yield leg on Meteora DBC → DAMM v2.
              </p>
              <div className="cta-row">
                <Link className="btn btn-primary" to="/app">
                  Open strip desk →
                </Link>
                <a className="btn btn-ghost" href="#how">
                  How it works
                </a>
              </div>
            </div>

            <div className="hero-stage" aria-hidden>
              <div className="hero-stage-frame">
                <div className="hs-top">
                  <span className="hs-live">
                    <i /> LIVE SCHEMA
                  </span>
                  <span className="hs-meta">KOx · nonce 5→7</span>
                </div>

                <div className="hs-stack">
                  <div className="hs-node hs-in">
                    <span className="hs-k">UNDERLYING</span>
                    <strong>xStock</strong>
                    <span className="hs-v">1.00</span>
                  </div>

                  <div className="hs-beam">
                    <span />
                    <span />
                    <span />
                  </div>

                  <div className="hs-split">
                    <div className="hs-node hs-pt">
                      <span className="hs-k">PRINCIPAL</span>
                      <strong>PT</strong>
                      <span className="hs-v">Yₛ / Yₜ</span>
                      <div className="hs-bar">
                        <i style={{ width: "78%" }} />
                      </div>
                    </div>
                    <div className="hs-node hs-yt">
                      <span className="hs-k">YIELD</span>
                      <strong>YT</strong>
                      <span className="hs-v">1 − Yₛ/Yₜ</span>
                      <div className="hs-bar">
                        <i style={{ width: "22%" }} />
                      </div>
                    </div>
                  </div>
                </div>

                <div className="hs-footer">
                  <div>
                    <span className="hs-k">FAIR COUPON</span>
                    <strong>2.24%</strong>
                  </div>
                  <div>
                    <span className="hs-k">VENUE</span>
                    <strong>DBC → DAMM</strong>
                  </div>
                  <div>
                    <span className="hs-k">DESK</span>
                    <strong>{MARKETS.length} mkts</strong>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <div className="ticker" aria-hidden>
        <div className="ticker-track">
          <div className="ticker-group">
            {MARKETS.map((m) => (
              <div className="ticker-item" key={`a-${m.symbol}`}>
                <StockLogo symbol={m.symbol} name={m.name} size={22} />
                <strong>{m.symbol}</strong>
                <span>{m.name}</span>
              </div>
            ))}
          </div>
          <div className="ticker-group" aria-hidden>
            {MARKETS.map((m) => (
              <div className="ticker-item" key={`b-${m.symbol}`}>
                <StockLogo symbol={m.symbol} name={m.name} size={22} />
                <strong>{m.symbol}</strong>
                <span>{m.name}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="shell">
        <section className="section" id="how">
          <div className="section-rail">
            <h2>How the split works</h2>
            <p className="lead">
              TradFi dividend strips on Solana — CRE keeps the calendar fresh from
              xStocks v2.
            </p>
          </div>
          <div className="flow">
            <div className="flow-step">
              <div className="n">01 — Wrap</div>
              <h3>Lock a window</h3>
              <p>
                Deposit xStock. DivStrip reads{" "}
                <code>current_yield_nonce</code>, sets{" "}
                <code>target = start + N</code>, and mints PT + YT 1:1 into
                escrow.
              </p>
            </div>
            <div className="flow-step">
              <div className="n">02 — Trade</div>
              <h3>Separate risks</h3>
              <p>
                Keep YT for the next coupons. Sell PT for equity beta without
                dividend noise — or the reverse.
              </p>
            </div>
            <div className="flow-step">
              <div className="n">03 — Redeem</div>
              <h3>Frozen coupon</h3>
              <p>
                Capital redeems <code>Yₛ/Yₜ</code>; yield redeems{" "}
                <code>1 − Yₛ/Yₜ</code>. Late YT never pays the live multiplier.
              </p>
            </div>
          </div>
        </section>

        <section className="section">
          <div className="section-rail">
            <h2>Why PT and YT</h2>
            <p className="lead">
              Structured products that only make sense once corporate actions
              live on-chain.
            </p>
          </div>
          <div className="usecases">
            <article className="usecase">
              <div className="tag">Desk</div>
              <div>
                <h3>Dividend strip market</h3>
                <p>
                  Price the next KOx or PEPx coupons as clean YT. Hedge or harvest
                  income without selling the stock narrative.
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
                  <code>1 − cum_y(start)/cum_y(target)</code>. If YT trades rich
                  or cheap, that’s a dividend-cut / surprise view.
                </p>
              </div>
            </article>
            <article className="usecase">
              <div className="tag">Meteora</div>
              <div>
                <h3>YT launch on DBC → DAMM v2</h3>
                <p>
                  Each yield window gets a Dynamic Bonding Curve seeded from the
                  fair coupon, then graduates to DAMM v2 — equity-strip discovery,
                  not memecoin meta.
                </p>
              </div>
            </article>
          </div>
        </section>

        <footer className="footer">
          <span>
            Built for Stocklana · {MARKETS.length} curated mega-cap xStocks
          </span>
          <Link to="/app">Launch the desk →</Link>
        </footer>
      </div>
    </>
  );
}
