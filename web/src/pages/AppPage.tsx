import { useCallback, useEffect, useMemo, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { Program, AnchorProvider, BN } from "@anchor-lang/core";
import { Nav } from "../components/Nav";
import {
  DIVSTRIP_PROGRAM_ID,
  MARKETS,
  couponFromCum,
  MULTIPLIER_SCALE,
} from "../lib/markets";
import {
  buildLaunchYtOnDbc,
  buildYtStripCurve,
  fetchPoolProgress,
  loadLaunches,
  migratorUrl,
  saveLaunch,
  StoredLaunch,
  WSOL_MINT,
} from "../lib/meteora-dbc";
import idl from "../lib/divstrip.json";

const PROGRAM_ID = new PublicKey(DIVSTRIP_PROGRAM_ID);
const REGISTRY_ID = new PublicKey(
  "2WSNFu4xuaH55gpMRBN1p64YuiUXZzyze38ERXEy1U1z"
);

function marketPda(mint: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("strip"), mint.toBuffer()],
    PROGRAM_ID
  )[0];
}

function seriesPda(market: PublicKey, start: number, target: number) {
  const startBuf = Buffer.alloc(4);
  startBuf.writeUInt32LE(start);
  const targetBuf = Buffer.alloc(4);
  targetBuf.writeUInt32LE(target);
  return PublicKey.findProgramAddressSync(
    [Buffer.from("series"), market.toBuffer(), startBuf, targetBuf],
    PROGRAM_ID
  )[0];
}

function ptMintPda(market: PublicKey, start: number, target: number) {
  const startBuf = Buffer.alloc(4);
  startBuf.writeUInt32LE(start);
  const targetBuf = Buffer.alloc(4);
  targetBuf.writeUInt32LE(target);
  return PublicKey.findProgramAddressSync(
    [Buffer.from("pt-mint"), market.toBuffer(), startBuf, targetBuf],
    PROGRAM_ID
  )[0];
}

function ytMintPda(market: PublicKey, start: number, target: number) {
  const startBuf = Buffer.alloc(4);
  startBuf.writeUInt32LE(start);
  const targetBuf = Buffer.alloc(4);
  targetBuf.writeUInt32LE(target);
  return PublicKey.findProgramAddressSync(
    [Buffer.from("yt-mint"), market.toBuffer(), startBuf, targetBuf],
    PROGRAM_ID
  )[0];
}

function vaultAuthority(market: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), market.toBuffer()],
    PROGRAM_ID
  )[0];
}

function readYieldNonce(data: Buffer): number {
  const nonceOffset = 8 + 32 + 32 + 32 + 8 + 1 + 1 + 8 + 8;
  return data.readUInt32LE(nonceOffset);
}

function readCumY(data: Buffer): bigint {
  const offset = 8 + 32 + 32 + 32 + 8 + 1 + 1;
  return data.readBigUInt64LE(offset);
}

export function AppPage() {
  const { connection } = useConnection();
  const wallet = useWallet();
  const [symbol, setSymbol] = useState(MARKETS[0].symbol);
  const [amount, setAmount] = useState("1");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [windowStart, setWindowStart] = useState(0);
  const [chainCumY, setChainCumY] = useState<bigint | null>(null);
  const [launches, setLaunches] = useState<StoredLaunch[]>([]);
  const [poolProgress, setPoolProgress] = useState<number | null>(null);

  const market = useMemo(
    () => MARKETS.find((m) => m.symbol === symbol) ?? MARKETS[0],
    [symbol]
  );

  const fairCoupon = useMemo(() => {
    if (chainCumY && chainCumY > 0n) {
      // Approximate target cum as current tip grown by lock window demo factor
      const target = BigInt(
        Math.floor(
          Number(chainCumY) * (1 + 0.004 * market.lockNonces)
        )
      );
      return couponFromCum(chainCumY, target);
    }
    const start = MULTIPLIER_SCALE;
    const target = BigInt(
      Math.floor(Number(MULTIPLIER_SCALE) * (1 + 0.004 * market.lockNonces))
    );
    return couponFromCum(start, target);
  }, [market, chainCumY]);

  const curvePreview = useMemo(
    () => buildYtStripCurve(fairCoupon),
    [fairCoupon]
  );

  const windowTarget = windowStart + market.lockNonces;

  useEffect(() => {
    setLaunches(loadLaunches());
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const underlying = new PublicKey(market.mint);
        const registry = PublicKey.findProgramAddressSync(
          [Buffer.from("registry"), underlying.toBuffer()],
          REGISTRY_ID
        )[0];
        const info = await connection.getAccountInfo(registry);
        if (!info || cancelled) {
          setWindowStart(market.demo.yieldNonce);
          setChainCumY(null);
          return;
        }
        setWindowStart(readYieldNonce(info.data));
        setChainCumY(readCumY(info.data));
      } catch {
        setWindowStart(market.demo.yieldNonce);
        setChainCumY(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [connection, market]);

  useEffect(() => {
    const launch = launches.find(
      (l) =>
        l.symbol === market.symbol &&
        l.startNonce === windowStart &&
        l.targetNonce === windowTarget
    );
    if (!launch) {
      setPoolProgress(null);
      return;
    }
    let cancelled = false;
    (async () => {
      const progress = await fetchPoolProgress(
        connection,
        new PublicKey(launch.pool)
      );
      if (!cancelled) {
        setPoolProgress(progress?.quoteProgress ?? null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [connection, launches, market.symbol, windowStart, windowTarget]);

  const activeLaunch = launches.find(
    (l) =>
      l.symbol === market.symbol &&
      l.startNonce === windowStart &&
      l.targetNonce === windowTarget
  );

  const split = useCallback(async () => {
    if (!wallet.publicKey || !wallet.sendTransaction) {
      setStatus("Connect Phantom (or Solana MetaMask snap) to split on-chain.");
      return;
    }
    setBusy(true);
    setStatus("Building wrap…");
    try {
      const provider = new AnchorProvider(
        connection,
        wallet as any,
        AnchorProvider.defaultOptions()
      );
      const program = new Program(idl as any, provider);
      const underlying = new PublicKey(market.mint);
      const marketKey = marketPda(underlying);
      const registry = PublicKey.findProgramAddressSync(
        [Buffer.from("registry"), underlying.toBuffer()],
        REGISTRY_ID
      )[0];

      const registryInfo = await connection.getAccountInfo(registry);
      if (!registryInfo) {
        throw new Error(
          `No ca_registry for ${market.symbol}. Deploy registry + backfill on local Surfpool first.`
        );
      }

      let marketInfo = await connection.getAccountInfo(marketKey);
      if (!marketInfo) {
        setStatus("Initializing strip market…");
        const vaultAuthInit = vaultAuthority(marketKey);
        await program.methods
          .initializeStrip(market.symbol, market.lockNonces)
          .accountsPartial({
            authority: wallet.publicKey,
            underlyingMint: underlying,
            registry,
            market: marketKey,
            vaultAuthority: vaultAuthInit,
            systemProgram: SystemProgram.programId,
          })
          .rpc();
      }

      const start = readYieldNonce(registryInfo.data);
      const target = start + market.lockNonces;
      setWindowStart(start);
      const series = seriesPda(marketKey, start, target);
      const ptMint = ptMintPda(marketKey, start, target);
      const ytMint = ytMintPda(marketKey, start, target);
      const vaultAuth = vaultAuthority(marketKey);

      const seriesInfo = await connection.getAccountInfo(series);
      const token2022 = TOKEN_2022_PROGRAM_ID;

      if (!seriesInfo) {
        setStatus(`Creating series [${start} → ${target}]…`);
        await program.methods
          .createSeries(start, target)
          .accountsPartial({
            payer: wallet.publicKey,
            market: marketKey,
            registry,
            series,
            ptMint,
            ytMint,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .rpc();
      }

      const raw = BigInt(Math.floor(Number(amount) * 1e6));
      if (raw <= 0n) throw new Error("Amount must be > 0");

      const userUnderlying = getAssociatedTokenAddressSync(
        underlying,
        wallet.publicKey,
        false,
        token2022
      );
      const userPt = getAssociatedTokenAddressSync(
        ptMint,
        wallet.publicKey,
        false,
        TOKEN_PROGRAM_ID
      );
      const userYt = getAssociatedTokenAddressSync(
        ytMint,
        wallet.publicKey,
        false,
        TOKEN_PROGRAM_ID
      );
      const vaultUnderlying = getAssociatedTokenAddressSync(
        underlying,
        vaultAuth,
        true,
        token2022
      );

      const preTx = new Transaction().add(
        createAssociatedTokenAccountIdempotentInstruction(
          wallet.publicKey,
          userPt,
          wallet.publicKey,
          ptMint,
          TOKEN_PROGRAM_ID
        ),
        createAssociatedTokenAccountIdempotentInstruction(
          wallet.publicKey,
          userYt,
          wallet.publicKey,
          ytMint,
          TOKEN_PROGRAM_ID
        )
      );
      await wallet.sendTransaction(preTx, connection);

      setStatus("Wrapping into PT + YT…");
      const sig = await program.methods
        .wrap(new BN(raw.toString()))
        .accountsPartial({
          user: wallet.publicKey,
          market: marketKey,
          registry,
          series,
          underlyingMint: underlying,
          ptMint,
          ytMint,
          userUnderlying,
          userPt,
          userYt,
          vaultUnderlying,
          vaultAuthority: vaultAuth,
          tokenProgram: token2022,
          ptTokenProgram: TOKEN_PROGRAM_ID,
          ytTokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      setStatus(`Split confirmed · ${sig.slice(0, 8)}… — launch YT on Meteora next`);
    } catch (err: any) {
      console.error(err);
      setStatus(err?.message ?? String(err));
    } finally {
      setBusy(false);
    }
  }, [amount, connection, market, wallet]);

  const launchYt = useCallback(async () => {
    if (!wallet.publicKey || !wallet.sendTransaction) {
      setStatus("Connect a Solana wallet to launch on Meteora DBC.");
      return;
    }
    setBusy(true);
    setStatus("Building Meteora DBC config + pool (DAMM v2 graduation)…");
    try {
      const launch = await buildLaunchYtOnDbc({
        connection,
        payer: wallet.publicKey,
        quoteMint: WSOL_MINT,
        window: {
          symbol: market.symbol,
          startNonce: windowStart,
          targetNonce: windowTarget,
          fairCoupon,
        },
      });

      launch.transaction.partialSign(...launch.signers);
      const sig = await wallet.sendTransaction(launch.transaction, connection, {
        skipPreflight: false,
      });
      await connection.confirmTransaction(sig, "confirmed");

      const stored: StoredLaunch = {
        symbol: market.symbol,
        startNonce: windowStart,
        targetNonce: windowTarget,
        fairCoupon,
        config: launch.config.toBase58(),
        pool: launch.pool.toBase58(),
        baseMint: launch.baseMint.toBase58(),
        quoteMint: launch.quoteMint.toBase58(),
        initialMarketCap: launch.initialMarketCap,
        migrationMarketCap: launch.migrationMarketCap,
        launchedAt: Date.now(),
      };
      saveLaunch(stored);
      setLaunches(loadLaunches());
      setStatus(
        `YT live on DBC · pool ${launch.pool.toBase58().slice(0, 8)}… · migrates to DAMM v2 at ~$${launch.migrationMarketCap.toLocaleString()} mcap`
      );
    } catch (err: any) {
      console.error(err);
      setStatus(err?.message ?? String(err));
    } finally {
      setBusy(false);
    }
  }, [
    connection,
    fairCoupon,
    market.symbol,
    wallet,
    windowStart,
    windowTarget,
  ]);

  return (
    <div className="shell">
      <Nav />
      <div className="app-header">
        <div>
          <div className="eyebrow">◆ Strip desk · Meteora DBC</div>
          <h1>Split → launch YT</h1>
          <p>
            Wrap an xStock into PT/YT, then price-discover the yield window on
            Meteora Dynamic Bonding Curve (graduates to DAMM v2).
          </p>
        </div>
      </div>

      <div className="split-panel">
        <div className="panel">
          <h2>1 · Wrap</h2>
          <div className="field">
            <label>Underlying</label>
            <select
              value={symbol}
              onChange={(e) => setSymbol(e.target.value)}
            >
              {MARKETS.map((m) => (
                <option key={m.symbol} value={m.symbol}>
                  {m.symbol} — {m.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Amount</label>
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              inputMode="decimal"
              placeholder="1.0"
            />
          </div>
          <div className="field">
            <label>Yield window</label>
            <input
              value={`nonce ${windowStart} → ${windowTarget}`}
              disabled
            />
          </div>
          <button
            className="btn btn-primary"
            disabled={busy}
            onClick={split}
            type="button"
          >
            {busy ? "Working…" : "Split into PT + YT"}
          </button>
          <p className="hint">
            Escrows xStock and mints DivStrip PT/YT 1:1 for the frozen window.
          </p>
        </div>

        <div className="panel">
          <h2>2 · Launch YT on Meteora</h2>
          <div className="formula">
            Fair coupon{" "}
            <strong>{(fairCoupon * 100).toFixed(2)}%</strong>
            <br />
            DBC initial mcap ~$
            {curvePreview.initialMarketCap.toLocaleString()} → DAMM v2 at ~$
            {curvePreview.migrationMarketCap.toLocaleString()}
          </div>
          <p className="hint" style={{ marginTop: 12 }}>
            Creates a DBC listing mint <code>YT{market.symbol}…</code> for this
            window, quote = WSOL, migration = <strong>DAMM v2</strong>. Curve
            fees start at 100bps and decay — equity-strip discovery, not meme
            sniping.
          </p>
          <button
            className="btn btn-primary"
            disabled={busy}
            onClick={launchYt}
            type="button"
            style={{ marginTop: 14 }}
          >
            {busy ? "Launching…" : "Launch YT on Meteora DBC"}
          </button>
          {activeLaunch && (
            <div className="hint" style={{ marginTop: 14 }}>
              Pool <code>{activeLaunch.pool.slice(0, 8)}…</code>
              {poolProgress != null && (
                <> · curve {Math.round(poolProgress * 100)}%</>
              )}
              <br />
              <a
                href={migratorUrl(activeLaunch.pool)}
                target="_blank"
                rel="noreferrer"
              >
                Open Meteora migrator →
              </a>
            </div>
          )}
          <div className="status">{status}</div>
        </div>
      </div>

      <div className="panel">
        <h2>Window &amp; YT value</h2>
        <div className="stats" style={{ marginTop: 8 }}>
          <div className="stat">
            <div className="label">◆ Window</div>
            <div className="value" style={{ fontSize: 20 }}>
              {windowStart}→{windowTarget}
            </div>
          </div>
          <div className="stat">
            <div className="label">◆ Fair coupon</div>
            <div className="value" style={{ fontSize: 20 }}>
              {(fairCoupon * 100).toFixed(2)}%
            </div>
          </div>
          <div className="stat">
            <div className="label">◆ Tip cum_y</div>
            <div className="value" style={{ fontSize: 20 }}>
              {chainCumY
                ? (Number(chainCumY) / Number(MULTIPLIER_SCALE)).toFixed(4)
                : market.demo.cumY}
            </div>
          </div>
          <div className="stat">
            <div className="label">◆ DBC→DAMM</div>
            <div className="value" style={{ fontSize: 20 }}>
              v2
            </div>
          </div>
        </div>
        <p className="hint" style={{ marginTop: 16 }}>
          Late YT never pays live multiplier — coupon is frozen at wrap as{" "}
          <code>1 − cum_y(start)/cum_y(target)</code>. Meteora price is the
          market’s view vs that fair value.
        </p>
      </div>

      <div className="panel" style={{ marginTop: 24 }}>
        <h2>Markets</h2>
        <table className="markets">
          <thead>
            <tr>
              <th>xStock</th>
              <th>PT</th>
              <th>YT / Meteora</th>
              <th>Stats</th>
            </tr>
          </thead>
          <tbody>
            {MARKETS.map((m) => {
              const launch = launches.find((l) => l.symbol === m.symbol);
              return (
                <tr key={m.symbol}>
                  <td>
                    <div className="sym">{m.symbol}</div>
                    <div className="hint">{m.name}</div>
                  </td>
                  <td>
                    <span className="pill">xCapital-{m.symbol}</span>
                    <div className="hint">Principal · ex-div path</div>
                  </td>
                  <td>
                    <span className="pill">xYield-{m.symbol}</span>
                    <div className="hint">
                      {launch
                        ? `DBC ${launch.pool.slice(0, 6)}… · fair ${(
                            launch.fairCoupon * 100
                          ).toFixed(2)}%`
                        : `${m.lockNonces}-nonce window · launch on DBC`}
                    </div>
                  </td>
                  <td>
                    <div>yield_nonce {m.demo.yieldNonce}</div>
                    <div>cum_y {m.demo.cumY}</div>
                    <div>events {m.demo.eventCount}</div>
                    <div className="hint">{m.demo.nextDivHint}</div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <footer className="footer">
        <span>DivStrip_ · Meteora DBC → DAMM v2</span>
        <span>RPC {connection.rpcEndpoint}</span>
      </footer>
    </div>
  );
}
