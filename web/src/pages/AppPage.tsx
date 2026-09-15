import { useCallback, useMemo, useState } from "react";
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
  MarketConfig,
  couponFromCum,
  MULTIPLIER_SCALE,
} from "../lib/markets";
import idl from "../lib/divstrip.json";

const PROGRAM_ID = new PublicKey(DIVSTRIP_PROGRAM_ID);

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

export function AppPage() {
  const { connection } = useConnection();
  const wallet = useWallet();
  const [symbol, setSymbol] = useState(MARKETS[0].symbol);
  const [amount, setAmount] = useState("1");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  const market = useMemo(
    () => MARKETS.find((m) => m.symbol === symbol) ?? MARKETS[0],
    [symbol]
  );

  const fairCoupon = useMemo(() => {
    // Demo fair coupon assuming ~0.5% yield over the window when no chain read
    const start = MULTIPLIER_SCALE;
    const target = BigInt(
      Math.floor(Number(MULTIPLIER_SCALE) * (1 + 0.004 * market.lockNonces))
    );
    return couponFromCum(start, target);
  }, [market]);

  const split = useCallback(async () => {
    if (!wallet.publicKey || !wallet.sendTransaction) {
      setStatus("Connect Phantom or MetaMask (Solana) to split on-chain.");
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
        new PublicKey("2WSNFu4xuaH55gpMRBN1p64YuiUXZzyze38ERXEy1U1z")
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
        marketInfo = await connection.getAccountInfo(marketKey);
      }

      // current_yield_nonce offset in RegistryLog header
      const nonceOffset = 8 + 32 + 32 + 32 + 8 + 1 + 1 + 8 + 8;
      const start = registryInfo.data.readUInt32LE(nonceOffset);
      const target = start + market.lockNonces;
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

      setStatus(`Split confirmed · ${sig.slice(0, 8)}…`);
    } catch (err: any) {
      console.error(err);
      setStatus(err?.message ?? String(err));
    } finally {
      setBusy(false);
    }
  }, [amount, connection, market, wallet]);

  return (
    <div className="shell">
      <Nav />
      <div className="app-header">
        <div>
          <div className="eyebrow">◆ Strip desk</div>
          <h1>Split an xStock</h1>
          <p>
            Connect Phantom or a Solana-enabled MetaMask snap. Local demo targets{" "}
            <code>127.0.0.1:8899</code> (Surfpool).
          </p>
        </div>
      </div>

      <div className="split-panel">
        <div className="panel">
          <h2>Wrap</h2>
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
            <label>Lock window</label>
            <input value={`${market.lockNonces} yield nonces`} disabled />
          </div>
          <button
            className="btn btn-primary"
            disabled={busy}
            onClick={split}
            type="button"
          >
            {busy ? "Splitting…" : "Split into PT + YT"}
          </button>
          <p className="hint">
            Unwrap burns both legs anytime at par. After maturity, redeem capital
            / yield separately at the frozen coupon.
          </p>
          <div className="formula">
            Fair coupon (illustrative):{" "}
            <strong>{(fairCoupon * 100).toFixed(2)}%</strong> · window N=
            {market.lockNonces}
          </div>
          <div className="status">{status}</div>
        </div>

        <div className="panel">
          <h2>Selected market</h2>
          <MarketDetail market={market} />
        </div>
      </div>

      <div className="panel">
        <h2>Markets</h2>
        <table className="markets">
          <thead>
            <tr>
              <th>xStock</th>
              <th>PT</th>
              <th>YT</th>
              <th>Stats</th>
            </tr>
          </thead>
          <tbody>
            {MARKETS.map((m) => (
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
                    Coupon claim · {m.lockNonces} nonces
                  </div>
                </td>
                <td>
                  <div>yield_nonce {m.demo.yieldNonce}</div>
                  <div>cum_y {m.demo.cumY}</div>
                  <div>events {m.demo.eventCount}</div>
                  <div className="hint">{m.demo.nextDivHint}</div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <footer className="footer">
        <span>DivStrip_ · ca_registry-backed windows</span>
        <span>RPC {connection.rpcEndpoint}</span>
      </footer>
    </div>
  );
}

function MarketDetail({ market }: { market: MarketConfig }) {
  return (
    <>
      <div className="sym">{market.symbol}</div>
      <p className="hint">{market.name}</p>
      <div className="stats" style={{ marginTop: 20 }}>
        <div className="stat">
          <div className="label">◆ PT</div>
          <div className="value" style={{ fontSize: 18 }}>
            xCapital
          </div>
        </div>
        <div className="stat">
          <div className="label">◆ YT</div>
          <div className="value" style={{ fontSize: 18 }}>
            xYield
          </div>
        </div>
        <div className="stat">
          <div className="label">◆ Nonce</div>
          <div className="value" style={{ fontSize: 18 }}>
            {market.demo.yieldNonce}
          </div>
        </div>
        <div className="stat">
          <div className="label">◆ Events</div>
          <div className="value" style={{ fontSize: 18 }}>
            {market.demo.eventCount}
          </div>
        </div>
      </div>
      <p className="hint" style={{ marginTop: 16 }}>
        Mint <code>{market.mint.slice(0, 4)}…{market.mint.slice(-4)}</code>
      </p>
    </>
  );
}
