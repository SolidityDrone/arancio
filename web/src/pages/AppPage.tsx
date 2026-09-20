import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import {
  Connection,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { Program, AnchorProvider, BN, Wallet } from "@anchor-lang/core";
import { Nav } from "../components/Nav";
import { StockLogo } from "../components/StockLogo";
import {
  StripInspectPanel,
  type LegHoldingRow,
} from "../components/StripInspectPanel";
import { DeskActivityLog } from "../components/DeskActivityLog";
import {
  DIVSTRIP_PROGRAM_ID,
  MARKETS,
  MarketSector,
  SECTORS,
  couponFromCum,
  MULTIPLIER_SCALE,
} from "../lib/markets";
import {
  fetchPoolProgress,
  loadLaunches,
  saveLaunch,
  StoredLaunch,
  DEFAULT_QUOTE_MINT,
  QUOTE_SYMBOL,
} from "../lib/meteora-dbc";
import {
  requestPoolLaunch,
  storedLaunchFromApi,
} from "../lib/launch-api";
import { fetchCurveLaunchState } from "../lib/strip-vault-tx";
import {
  ensureRegistrySeeded,
  registryPda,
} from "../lib/seed-registry";
import {
  activitiesForSymbol,
  appendDeskActivity,
  loadDeskActivities,
} from "../lib/desk-activity";
import { positionsForSymbol, saveStripPosition } from "../lib/strip-positions";
import { sendTransactionChecked } from "../lib/wallet-tx";
import { isTxDenied } from "../lib/tx-error";
import { formatSimHint } from "../lib/tx-preview";
import {
  formatRawAmount,
  uiAmountToRaw,
  redeemOutputRaw,
  windowPhase,
} from "../lib/strip-math";
import { fetchWindowCumYs } from "../lib/registry-cum-y";
import {
  buildRedeemCapitalTransaction,
  buildRedeemYieldTransaction,
  buildUnwrapTransaction,
} from "../lib/strip-tx";
import { assignRegistryYieldNonces } from "../lib/registry-nonces";
import {
  buildCaListRows,
  caRowKey,
  fetchMarketIntel,
  fetchPricesUsd,
  formatStockPrice,
  formatUsd,
  mergeCorporateActions,
  trailingDivYield,
  type CaListRow,
  type MarketIntel,
} from "../lib/xstocks-api";
import idl from "../lib/divstrip.json";

const PROGRAM_ID = new PublicKey(DIVSTRIP_PROGRAM_ID);

/** How far ahead of tip the window start may sit. */
const MAX_FORWARD = 8;
/** Max target − start span. */
const MAX_SPAN = 8;

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

function readEventCount(data: Buffer): number {
  const offset = 8 + 32 + 32 + 32 + 8 + 1 + 1 + 8 + 8 + 4;
  return data.readUInt32LE(offset);
}

function explainTxError(err: unknown): string {
  if (isTxDenied(err)) {
    return "Transaction denied — nothing was sent on-chain";
  }
  const msg = err instanceof Error ? err.message : String(err);
  if (
    msg.includes("Failed to fetch accounts from remote") ||
    msg.includes("mainnet-beta.solana.com")
  ) {
    return (
      "Surfpool could not fetch mainnet accounts for this transaction " +
      "(network blocked or mainnet RPC down). Ensure Surfpool has internet, " +
      "wait for fork sync, then retry. Phantom “cannot simulate” is the same root cause."
    );
  }
  if (/simulation failed|simulate/i.test(msg)) {
    return (
      "Simulation failed on Surfpool — usually mainnet fetch or missing program deploy. " +
      "Confirm Phantom uses Localhost/Surfpool RPC (127.0.0.1:8899), programs are deployed, " +
      "and Surfpool terminal shows no mainnet errors."
    );
  }
  if (msg.includes("0x1784") || msg.includes("6020")) {
    return (
      "Meteora DBC rejected the curve (InvalidTokenSupply). Reload the app — curve params " +
      "were updated. If it persists, Surfpool may be offline or missing Meteora programs."
    );
  }
  return msg;
}

function fairCouponFromYieldEvents(
  events: CorporateAction[],
  lockNonces: number,
  chainCumY: bigint | null
): number | null {
  if (events.length === 0 || lockNonces <= 0) return null;
  const slice = events.slice(-lockNonces);
  if (slice.length === 0) return null;

  let product = 1;
  for (const event of slice) {
    const old = Number(event.multiplierOld);
    const next = Number(event.multiplierNew);
    if (!old || !next) return null;
    product *= next / old;
  }

  const cumStart =
    chainCumY && chainCumY > 0n ? chainCumY : MULTIPLIER_SCALE;
  const cumTarget = BigInt(Math.floor(Number(cumStart) * product));
  if (cumTarget <= cumStart) return 0;
  return couponFromCum(cumStart, cumTarget);
}

function fairCouponFromChain(
  chainCumY: bigint | null,
  lockNonces: number
): number {
  const cumStart =
    chainCumY && chainCumY > 0n ? chainCumY : MULTIPLIER_SCALE;
  const target = BigInt(
    Math.floor(Number(cumStart) * (1 + 0.004 * lockNonces))
  );
  return couponFromCum(cumStart, target);
}

function formatCaDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatMultiplierPair(
  old: string | null | undefined,
  next: string | null | undefined
): string {
  if (!old || !next) return "—";
  return `${Number(old).toFixed(4)} → ${Number(next).toFixed(4)}`;
}

function windowKey(start: number, target: number): string {
  return `${start}:${target}`;
}

async function fetchSplBalance(
  connection: Connection,
  mint: PublicKey,
  owner: PublicKey
): Promise<{ ui: string; raw: bigint }> {
  const ata = getAssociatedTokenAddressSync(
    mint,
    owner,
    false,
    TOKEN_PROGRAM_ID
  );
  try {
    const balance = await connection.getTokenAccountBalance(ata);
    return {
      ui: balance.value.uiAmountString ?? "0",
      raw: BigInt(balance.value.amount),
    };
  } catch {
    return { ui: "0", raw: 0n };
  }
}

export function AppPage() {
  const { connection } = useConnection();
  const wallet = useWallet();
  const [searchParams] = useSearchParams();
  const [symbol, setSymbol] = useState("KOx");
  const [search, setSearch] = useState("");
  const [sector, setSector] = useState<MarketSector | "All">("All");
  const [amount, setAmount] = useState("1");
  const [unwrapAmount, setUnwrapAmount] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [tipNonce, setTipNonce] = useState(0);
  const [windowStart, setWindowStart] = useState(0);
  const [windowTarget, setWindowTarget] = useState(2);
  const [chainCumY, setChainCumY] = useState<bigint | null>(null);
  const [registryReady, setRegistryReady] = useState(false);
  const [onchainEvents, setOnchainEvents] = useState(0);
  const [launches, setLaunches] = useState<StoredLaunch[]>([]);
  const [verifiedLaunch, setVerifiedLaunch] = useState<StoredLaunch | null>(null);
  const [onChainLaunch, setOnChainLaunch] = useState<
    Awaited<ReturnType<typeof fetchCurveLaunchState>> | null
  >(null);
  const [launchRefresh, setLaunchRefresh] = useState(0);
  const [poolProgress, setPoolProgress] = useState<{
    quoteProgress: number;
    isMigrated: boolean;
  } | null>(null);
  const [intel, setIntel] = useState<MarketIntel | null>(null);
  const [intelLoading, setIntelLoading] = useState(false);
  const [marketPrices, setMarketPrices] = useState<
    Record<string, number | null>
  >({});
  const [walletBalance, setWalletBalance] = useState<{
    uiAmountString: string;
    rawAmount: bigint;
    decimals: number;
  } | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [legHoldings, setLegHoldings] = useState<LegHoldingRow[]>([]);
  const [legsLoading, setLegsLoading] = useState(false);
  const [positionsVersion, setPositionsVersion] = useState(0);
  const [activityVersion, setActivityVersion] = useState(0);
  const [inspectStart, setInspectStart] = useState(0);
  const [inspectTarget, setInspectTarget] = useState(2);
  const [inspectSource, setInspectSource] = useState<"manual" | "portfolio">(
    "portfolio"
  );

  const market = useMemo(
    () => MARKETS.find((m) => m.symbol === symbol) ?? MARKETS[0],
    [symbol]
  );

  const filteredMarkets = useMemo(() => {
    const q = search.trim().toLowerCase();
    return MARKETS.filter((m) => {
      if (sector !== "All" && m.sector !== sector) return false;
      if (!q) return true;
      return (
        m.symbol.toLowerCase().includes(q) ||
        m.name.toLowerCase().includes(q) ||
        m.sector.toLowerCase().includes(q)
      );
    });
  }, [search, sector]);

  const lockNonces = Math.max(1, windowTarget - windowStart);
  const isForwardWindow = windowStart > tipNonce;
  const startMax = tipNonce + MAX_FORWARD;
  const underlyingDecimals = walletBalance?.decimals ?? 8;

  const splitWindowRow = useMemo(
    () =>
      legHoldings.find(
        (r) =>
          r.startNonce === windowStart && r.targetNonce === windowTarget
      ) ?? null,
    [legHoldings, windowStart, windowTarget]
  );

  const splitPhase = windowPhase(tipNonce, windowStart, windowTarget);

  const [splitCums, setSplitCums] = useState({
    cumStart: MULTIPLIER_SCALE,
    cumTarget: MULTIPLIER_SCALE,
  });

  useEffect(() => {
    setUnwrapAmount("");
  }, [windowStart, windowTarget, market.symbol]);

  useEffect(() => {
    if (!splitWindowRow?.seriesExists || splitPhase !== "mature") return;
    let cancelled = false;
    (async () => {
      try {
        const underlying = new PublicKey(market.mint);
        const programId = new PublicKey(DIVSTRIP_PROGRAM_ID);
        const marketKey = marketPda(underlying);
        const startBuf = Buffer.alloc(4);
        startBuf.writeUInt32LE(windowStart);
        const targetBuf = Buffer.alloc(4);
        targetBuf.writeUInt32LE(windowTarget);
        const series = PublicKey.findProgramAddressSync(
          [Buffer.from("series"), marketKey.toBuffer(), startBuf, targetBuf],
          programId
        )[0];
        const seriesInfo = await connection.getAccountInfo(series);
        const cums = await fetchWindowCumYs(
          connection,
          underlying,
          windowStart,
          windowTarget,
          seriesInfo?.data ?? null
        );
        if (!cancelled) setSplitCums(cums);
      } catch {
        if (!cancelled) {
          setSplitCums({
            cumStart: MULTIPLIER_SCALE,
            cumTarget: MULTIPLIER_SCALE,
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    connection,
    market.mint,
    splitPhase,
    splitWindowRow?.seriesExists,
    windowStart,
    windowTarget,
  ]);

  const splitPtRedeemRaw = redeemOutputRaw(
    splitWindowRow?.ptRaw ?? 0n,
    splitCums.cumStart,
    splitCums.cumTarget,
    true
  );
  const splitYtRedeemRaw = redeemOutputRaw(
    splitWindowRow?.ytRaw ?? 0n,
    splitCums.cumStart,
    splitCums.cumTarget,
    false
  );
  const splitMatureExitRaw = splitPtRedeemRaw + splitYtRedeemRaw;

  const fairCoupon = useMemo(() => {
    const fromIntel = intel
      ? fairCouponFromYieldEvents(intel.yieldEvents, lockNonces, chainCumY)
      : null;
    if (fromIntel != null) return fromIntel;
    return fairCouponFromChain(chainCumY, lockNonces);
  }, [intel, lockNonces, chainCumY]);

  const fairCouponForWindow = useCallback(
    (start: number, target: number) => {
      const lock = Math.max(1, target - start);
      const fromIntel = intel
        ? fairCouponFromYieldEvents(intel.yieldEvents, lock, chainCumY)
        : null;
      if (fromIntel != null) return fromIntel;
      return fairCouponFromChain(chainCumY, lock);
    },
    [intel, chainCumY]
  );

  const amountNum = useMemo(() => {
    const n = Number(amount);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }, [amount]);

  const notionalUsd = useMemo(() => {
    if (!intel?.priceUsd || amountNum <= 0) return null;
    return intel.priceUsd * amountNum;
  }, [intel?.priceUsd, amountNum]);

  const symbolActivities = useMemo(() => {
    void activityVersion;
    const acts = activitiesForSymbol(market.symbol);
    return acts.map((a) => {
      if (a.pool) return a;
      const launch = launches.find(
        (l) =>
          l.symbol === a.symbol &&
          l.startNonce === a.startNonce &&
          l.targetNonce === a.targetNonce
      );
      if (!launch) return a;
      return {
        ...a,
        pool: launch.pool,
        baseMint: launch.baseMint,
        quoteMint: launch.quoteMint,
      };
    });
  }, [market.symbol, activityVersion, launches]);

  const caNonceByEventId = useMemo(() => {
    if (!intel) return new Map<string, { yieldNonce: number; advancesTip: boolean }>();
    return assignRegistryYieldNonces(
      mergeCorporateActions(intel.history, intel.upcoming)
    );
  }, [intel]);

  const caRows = useMemo((): CaListRow[] => {
    if (!intel) return [];
    return buildCaListRows(intel.history, intel.upcoming);
  }, [intel]);

  const tradingLabel = useMemo(() => {
    const asset = intel?.asset;
    if (!asset) return null;
    if (asset.isTradingHalted) return "Halted";
    if (asset.trading?.openNow === true) return "Open";
    if (asset.trading?.openNow === false) return "Closed";
    return null;
  }, [intel?.asset]);

  const trailYield = useMemo(
    () => trailingDivYield(intel?.history ?? [], intel?.priceUsd ?? null),
    [intel?.history, intel?.priceUsd]
  );

  const applyTip = useCallback((tip: number) => {
    setTipNonce(tip);
    setWindowStart((prevStart) => {
      const nextStart = Math.max(tip, Math.min(prevStart, tip + MAX_FORWARD));
      setWindowTarget((prevTarget) => {
        const span = Math.max(1, Math.min(MAX_SPAN, prevTarget - prevStart || 2));
        return Math.min(nextStart + MAX_SPAN, Math.max(nextStart + 1, nextStart + span));
      });
      return nextStart;
    });
  }, []);

  const refreshWalletBalance = useCallback(async () => {
    if (!wallet.publicKey) {
      setWalletBalance(null);
      return;
    }
    setBalanceLoading(true);
    try {
      const underlying = new PublicKey(market.mint);
      const mintInfo = await connection.getParsedAccountInfo(underlying);
      const mintDecimals =
        (
          mintInfo.value?.data as
            | { parsed?: { info?: { decimals?: number } } }
            | undefined
        )?.parsed?.info?.decimals ?? 8;

      const ata = getAssociatedTokenAddressSync(
        underlying,
        wallet.publicKey,
        false,
        TOKEN_2022_PROGRAM_ID
      );
      try {
        const balance = await connection.getTokenAccountBalance(ata);
        setWalletBalance({
          uiAmountString: balance.value.uiAmountString ?? "0",
          rawAmount: BigInt(balance.value.amount),
          decimals: balance.value.decimals,
        });
      } catch {
        setWalletBalance({
          uiAmountString: "0",
          rawAmount: 0n,
          decimals: mintDecimals,
        });
      }
    } catch {
      setWalletBalance(null);
    } finally {
      setBalanceLoading(false);
    }
  }, [connection, market.mint, wallet.publicKey]);

  const setMaxAmount = useCallback(() => {
    if (!walletBalance || walletBalance.rawAmount <= 0n) return;
    setAmount(walletBalance.uiAmountString);
  }, [walletBalance]);

  const refreshLegHoldings = useCallback(async () => {
    if (!wallet.publicKey) {
      setLegHoldings([]);
      return;
    }
    setLegsLoading(true);
    try {
      const underlying = new PublicKey(market.mint);
      const marketKey = marketPda(underlying);
      const seen = new Set<string>();
      const windows: { start: number; target: number }[] = [];

      const addWindow = (start: number, target: number) => {
        const key = windowKey(start, target);
        if (seen.has(key)) return;
        seen.add(key);
        windows.push({ start, target });
      };

      addWindow(windowStart, windowTarget);
      for (const p of positionsForSymbol(market.symbol)) {
        addWindow(p.startNonce, p.targetNonce);
      }

      const rows = await Promise.all(
        windows.map(async ({ start, target }) => {
          const series = seriesPda(marketKey, start, target);
          const seriesInfo = await connection.getAccountInfo(series);
          if (!seriesInfo) {
            return {
              startNonce: start,
              targetNonce: target,
              seriesExists: false,
              ptAmount: "0",
              ytAmount: "0",
              ptRaw: 0n,
              ytRaw: 0n,
            };
          }
          const ptMint = ptMintPda(marketKey, start, target);
          const ytMint = ytMintPda(marketKey, start, target);
          const [pt, yt] = await Promise.all([
            fetchSplBalance(connection, ptMint, wallet.publicKey!),
            fetchSplBalance(connection, ytMint, wallet.publicKey!),
          ]);
          return {
            startNonce: start,
            targetNonce: target,
            seriesExists: true,
            ptAmount: formatRawAmount(pt.raw, underlyingDecimals),
            ytAmount: formatRawAmount(yt.raw, underlyingDecimals),
            ptRaw: pt.raw,
            ytRaw: yt.raw,
          };
        })
      );

      rows.sort((a, b) => b.startNonce - a.startNonce || b.targetNonce - a.targetNonce);
      setLegHoldings(rows);
    } catch {
      setLegHoldings([]);
    } finally {
      setLegsLoading(false);
    }
  }, [
    connection,
    market.mint,
    market.symbol,
    positionsVersion,
    wallet.publicKey,
    underlyingDecimals,
    windowStart,
    windowTarget,
  ]);

  const refreshRegistry = useCallback(async () => {
    try {
      const underlying = new PublicKey(market.mint);
      const registry = registryPda(underlying);
      const info = await connection.getAccountInfo(registry);
      if (!info) {
        setRegistryReady(false);
        applyTip(market.demo.yieldNonce);
        setChainCumY(null);
        setOnchainEvents(0);
        return;
      }
      setRegistryReady(true);
      applyTip(readYieldNonce(info.data));
      setChainCumY(readCumY(info.data));
      setOnchainEvents(readEventCount(info.data));
    } catch {
      setRegistryReady(false);
      applyTip(market.demo.yieldNonce);
      setChainCumY(null);
      setOnchainEvents(0);
    }
  }, [applyTip, connection, market]);

  const onStartSlider = (raw: number) => {
    const start = Math.max(tipNonce, Math.min(startMax, raw));
    const span = Math.min(MAX_SPAN, Math.max(1, windowTarget - windowStart));
    setWindowStart(start);
    setWindowTarget(start + span);
  };

  const onSpanStep = (delta: number) => {
    const next = Math.max(1, Math.min(MAX_SPAN, lockNonces + delta));
    setWindowTarget(windowStart + next);
  };

  const onTargetSlider = (raw: number) => {
    const target = Math.max(
      windowStart + 1,
      Math.min(windowStart + MAX_SPAN, raw)
    );
    setWindowTarget(target);
  };

  useEffect(() => {
    setLaunches(loadLaunches());
    loadDeskActivities();
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const prices = await fetchPricesUsd(MARKETS.map((m) => m.symbol));
      if (!cancelled) setMarketPrices(prices);
    };
    void load();
    const t = window.setInterval(load, 120_000);
    return () => {
      cancelled = true;
      window.clearInterval(t);
    };
  }, []);

  useEffect(() => {
    const sym = searchParams.get("symbol");
    const start = searchParams.get("start");
    const target = searchParams.get("target");
    if (sym && MARKETS.some((m) => m.symbol === sym)) {
      setSymbol(sym);
    }
    if (start != null && target != null) {
      const s = parseInt(start, 10);
      const t = parseInt(target, 10);
      if (Number.isFinite(s) && Number.isFinite(t) && t > s) {
        setWindowStart(s);
        setWindowTarget(t);
      }
    }
  }, [searchParams]);

  useEffect(() => {
    const sym = searchParams.get("symbol");
    const hasWindowInUrl =
      searchParams.get("start") != null && searchParams.get("target") != null;
    if (sym === symbol && hasWindowInUrl) {
      setIntel(null);
      return;
    }
    setWindowStart(0);
    setWindowTarget(2);
    setIntel(null);
  }, [symbol, searchParams]);

  useEffect(() => {
    void refreshRegistry();
  }, [refreshRegistry]);

  useEffect(() => {
    void refreshWalletBalance();
  }, [refreshWalletBalance]);

  useEffect(() => {
    void refreshLegHoldings();
  }, [refreshLegHoldings]);

  useEffect(() => {
    let cancelled = false;
    setIntelLoading(true);
    (async () => {
      try {
        const data = await fetchMarketIntel(symbol);
        if (!cancelled) setIntel(data);
      } catch {
        if (!cancelled) setIntel(null);
      } finally {
        if (!cancelled) setIntelLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [symbol]);

  useEffect(() => {
    setInspectStart(windowStart);
    setInspectTarget(windowTarget);
    setInspectSource("portfolio");
  }, [symbol, windowStart, windowTarget]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const underlying = new PublicKey(market.mint);
      const chain = await fetchCurveLaunchState(connection, {
        underlyingMint: underlying,
        startNonce: inspectStart,
        targetNonce: inspectTarget,
      });
      if (cancelled) return;
      setOnChainLaunch(chain);

      const local = launches.find(
        (l) =>
          l.symbol === market.symbol &&
          l.startNonce === inspectStart &&
          l.targetNonce === inspectTarget
      );

      const inspectFair = fairCouponForWindow(inspectStart, inspectTarget);
      let launch: StoredLaunch | null = null;

      if (chain.registered && chain.pool && chain.curveYtMint) {
        const poolMatch = local?.pool === chain.pool.toBase58();
        launch = poolMatch
          ? local!
          : {
              symbol: market.symbol,
              startNonce: inspectStart,
              targetNonce: inspectTarget,
              fairCoupon:
                (chain.launchFairPpm ?? Math.round(inspectFair * 1_000_000)) /
                1_000_000,
              config: local?.config ?? "",
              pool: chain.pool.toBase58(),
              baseMint: chain.curveYtMint.toBase58(),
              quoteMint: DEFAULT_QUOTE_MINT.toBase58(),
              initialMarketCap:
                chain.initialMcapUsd ?? local?.initialMarketCap ?? 5_000,
              migrationMarketCap:
                chain.migrationMcapUsd ?? local?.migrationMarketCap ?? 75_000,
              launchedAt: local?.launchedAt ?? Date.now(),
              launchSignature: local?.launchSignature,
            };
      } else if (local) {
        launch = local;
      }

      if (!launch) {
        setVerifiedLaunch(null);
        setPoolProgress(null);
        return;
      }

      const poolKey = new PublicKey(launch.pool);
      const poolInfo = await connection.getAccountInfo(poolKey);
      if (!poolInfo) {
        if (!cancelled) {
          setVerifiedLaunch(null);
          setPoolProgress(null);
        }
        return;
      }
      if (!cancelled) setVerifiedLaunch(launch);
      const progress = await fetchPoolProgress(connection, poolKey);
      if (!cancelled) {
        setPoolProgress(
          progress
            ? {
                quoteProgress: progress.quoteProgress,
                isMigrated: progress.isMigrated,
              }
            : null
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    connection,
    fairCouponForWindow,
    inspectStart,
    inspectTarget,
    launchRefresh,
    launches,
    market.mint,
    market.symbol,
  ]);

  const activeLaunch = verifiedLaunch;

  const selectInspectWindow = useCallback((start: number, target: number) => {
    setInspectStart(start);
    setInspectTarget(target);
    setInspectSource("portfolio");
  }, []);

  const split = useCallback(async () => {
    if (!wallet.publicKey || !wallet.sendTransaction) {
      setStatus("Connect Phantom or Solflare to split on-chain.");
      return;
    }
    setBusy(true);
    setStatus("Checking registry…");
    try {
      const provider = new AnchorProvider(
        connection,
        wallet as unknown as Wallet,
        AnchorProvider.defaultOptions()
      );
      const program = new Program(idl as never, provider);
      const underlying = new PublicKey(market.mint);
      const marketKey = marketPda(underlying);
      let registry = registryPda(underlying);

      let registryInfo = await connection.getAccountInfo(registry);
      if (!registryInfo) {
        setStatus(`No ca_registry for ${market.symbol} — seeding from xStocks…`);
        await ensureRegistrySeeded({
          connection,
          wallet: wallet as unknown as Wallet,
          symbol: market.symbol,
          mint: market.mint,
          onProgress: setStatus,
        });
        registry = registryPda(underlying);
        registryInfo = await connection.getAccountInfo(registry);
        if (!registryInfo) {
          throw new Error(`Failed to initialize ca_registry for ${market.symbol}.`);
        }
        setRegistryReady(true);
      }

      const tip = readYieldNonce(registryInfo.data);
      applyTip(tip);
      const start = Math.max(tip, windowStart);
      const target = Math.max(start + 1, windowStart === start ? windowTarget : start + lockNonces);
      if (target <= start) {
        throw new Error("Window target must be greater than start.");
      }
      if (target - start > MAX_SPAN) {
        throw new Error(`Window span max is ${MAX_SPAN} nonces.`);
      }

      let marketInfo = await connection.getAccountInfo(marketKey);
      if (!marketInfo) {
        setStatus(
          "Confirm signature 1/2: initialize strip market (one-time per xStock)…"
        );
        const vaultAuthInit = vaultAuthority(marketKey);
        const initTx = await program.methods
          .initializeStrip(market.symbol, target - start)
          .accountsPartial({
            authority: wallet.publicKey,
            underlyingMint: underlying,
            registry,
            market: marketKey,
            vaultAuthority: vaultAuthInit,
            systemProgram: SystemProgram.programId,
          })
          .transaction();
        await sendTransactionChecked(connection, initTx, wallet, {
          modalLabel: "market init",
        });
      }

      const series = seriesPda(marketKey, start, target);
      const ptMint = ptMintPda(marketKey, start, target);
      const ytMint = ytMintPda(marketKey, start, target);
      const vaultAuth = vaultAuthority(marketKey);
      const token2022 = TOKEN_2022_PROGRAM_ID;

      const seriesInfo = await connection.getAccountInfo(series);
      const needsSeries = !seriesInfo;

      const raw = uiAmountToRaw(amount.trim(), underlyingDecimals);
      if (raw <= 0n) throw new Error("Amount must be greater than zero.");

      const userUnderlying = getAssociatedTokenAddressSync(
        underlying,
        wallet.publicKey,
        false,
        token2022
      );

      const available = walletBalance?.rawAmount ?? 0n;
      if (available <= 0n) {
        throw new Error(
          `Zero ${market.symbol} balance — fund your wallet with xStock (Token-2022) before splitting.`
        );
      }
      if (available < raw) {
        throw new Error(
          `Insufficient ${market.symbol}: have ${walletBalance?.uiAmountString ?? "0"}, need ${amount}.`
        );
      }

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

      const wrapPreIxs: TransactionInstruction[] = [];

      if (needsSeries) {
        wrapPreIxs.push(
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
            .instruction()
        );
      }

      wrapPreIxs.push(
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

      const wrapSteps = [
        needsSeries ? "create series" : null,
        "open PT/YT accounts",
        "split into PT + YT",
      ]
        .filter(Boolean)
        .join(" + ");

      const wrapTx = await program.methods
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
        .preInstructions(wrapPreIxs)
        .transaction();
      const sig = await sendTransactionChecked(connection, wrapTx, wallet, {
        modalLabel: "split",
        beforeWallet: (sim) =>
          setStatus(
            `${formatSimHint(sim)} · split (${wrapSteps}) — confirm in wallet`
          ),
      });
      selectInspectWindow(start, target);

      const splitAmount = amount.trim() || amountNum.toString();
      saveStripPosition({
        symbol: market.symbol,
        startNonce: start,
        targetNonce: target,
        splitAt: Date.now(),
        signature: sig,
        amount: splitAmount,
      });
      appendDeskActivity({
        kind: "split",
        symbol: market.symbol,
        startNonce: start,
        targetNonce: target,
        at: Date.now(),
        signature: sig,
        amount: splitAmount,
        amountSymbol: market.symbol,
      });
      setPositionsVersion((v) => v + 1);
      setActivityVersion((v) => v + 1);
      await refreshRegistry();
      await refreshWalletBalance();
      await refreshLegHoldings();
      setStatus(
        `Split confirmed · window ${start}→${target} · ${sig.slice(0, 8)}… — launch curve-YT pool on Meteora next`
      );
    } catch (err: unknown) {
      console.error(err);
      setStatus(explainTxError(err));
    } finally {
      setBusy(false);
    }
  }, [
    amount,
    amountNum,
    applyTip,
    connection,
    lockNonces,
    market,
    refreshRegistry,
    refreshLegHoldings,
    refreshWalletBalance,
    selectInspectWindow,
    wallet,
    walletBalance,
    underlyingDecimals,
    windowStart,
    windowTarget,
  ]);

  const requestPool = useCallback(async () => {
    setBusy(true);
    setStatus("Checking registry…");
    try {
      const start = inspectStart;
      const target = inspectTarget;
      const windowFair = fairCouponForWindow(start, target);

      if (!registryReady) {
        if (!wallet.publicKey || !wallet.sendTransaction) {
          setStatus("Connect a wallet to seed ca_registry before requesting a pool.");
          return;
        }
        setStatus(`No ca_registry for ${market.symbol} — seeding from xStocks…`);
        const result = await ensureRegistrySeeded({
          connection,
          wallet: wallet as unknown as Wallet,
          symbol: market.symbol,
          mint: market.mint,
          onProgress: setStatus,
        });
        setRegistryReady(true);
        applyTip(result.yieldNonce);
        setOnchainEvents(result.eventCount);
        await refreshRegistry();
      }

      setStatus("Requesting pool via backend → CRE → on-chain launch…");
      const apiRes = await requestPoolLaunch({
        mint: market.mint,
        symbol: market.symbol,
        startNonce: start,
        targetNonce: target,
        fairCoupon: windowFair,
      });

      const stored = storedLaunchFromApi(
        {
          mint: market.mint,
          symbol: market.symbol,
          startNonce: start,
          targetNonce: target,
          fairCoupon: windowFair,
        },
        apiRes
      );
      if (!stored) {
        throw new Error(
          apiRes.executorStatus ??
            "Launch finished without pool metadata — check CRE + backend logs."
        );
      }

      saveLaunch(stored);
      appendDeskActivity({
        kind: "dbc_launch",
        symbol: market.symbol,
        startNonce: start,
        targetNonce: target,
        at: Date.now(),
        signature: apiRes.launchSignature ?? "",
        pool: stored.pool,
        baseMint: stored.baseMint,
        quoteMint: stored.quoteMint,
      });
      setLaunches(loadLaunches());
      setActivityVersion((v) => v + 1);
      setLaunchRefresh((v) => v + 1);
      setStatus(
        `curve-YT pool live · ${stored.pool.slice(0, 8)}… · registered ${(apiRes.registerSignature ?? "").slice(0, 8)}…`
      );
    } catch (err: unknown) {
      console.error(err);
      const msg = err instanceof Error ? err.message : String(err);
      setStatus(
        /fetch|Failed to fetch|NetworkError/i.test(msg)
          ? "Launch backend unreachable — start launch-backend + CRE HTTP trigger (see README)."
          : explainTxError(err)
      );
    } finally {
      setBusy(false);
    }
  }, [
    applyTip,
    connection,
    fairCouponForWindow,
    inspectStart,
    inspectTarget,
    market.mint,
    market.symbol,
    refreshRegistry,
    registryReady,
    wallet,
  ]);

  const unwrapPosition = useCallback(
    async (start: number, target: number, amountRaw: bigint) => {
      if (!wallet.publicKey || !wallet.sendTransaction) {
        setStatus("Connect wallet to unwrap PT + YT.");
        return;
      }
      if (amountRaw <= 0n) {
        setStatus("Need equal PT and YT balances to unwrap.");
        return;
      }
      setBusy(true);
      setStatus("Building unwrap…");
      try {
        const underlying = new PublicKey(market.mint);
        const tx = await buildUnwrapTransaction(
          connection,
          wallet.publicKey,
          { underlyingMint: underlying, startNonce: start, targetNonce: target },
          amountRaw
        );
        const sig = await sendTransactionChecked(connection, tx, wallet, {
          modalLabel: "unwrap",
        });
        const ui = formatRawAmount(amountRaw, underlyingDecimals);
        appendDeskActivity({
          kind: "unwrap",
          symbol: market.symbol,
          startNonce: start,
          targetNonce: target,
          at: Date.now(),
          signature: sig,
          amount: ui,
          amountSymbol: market.symbol,
        });
        setActivityVersion((v) => v + 1);
        await refreshLegHoldings();
        await refreshWalletBalance();
        setStatus(`Unwrapped ${ui} ${market.symbol} · ${sig.slice(0, 8)}…`);
      } catch (err: unknown) {
        console.error(err);
        setStatus(explainTxError(err));
      } finally {
        setBusy(false);
      }
    },
    [
      connection,
      market.mint,
      market.symbol,
      refreshLegHoldings,
      refreshWalletBalance,
      wallet,
      underlyingDecimals,
    ]
  );

  const redeemPt = useCallback(
    async (
      start: number,
      target: number,
      amountRaw: bigint,
      opts?: { manageBusy?: boolean }
    ) => {
      if (!wallet.publicKey || !wallet.sendTransaction) {
        setStatus("Connect wallet to redeem PT.");
        return;
      }
      if (amountRaw <= 0n) return;
      const manageBusy = opts?.manageBusy ?? true;
      if (manageBusy) setBusy(true);
      setStatus("Building PT redeem…");
      try {
        const underlying = new PublicKey(market.mint);
        const tx = await buildRedeemCapitalTransaction(
          connection,
          wallet.publicKey,
          { underlyingMint: underlying, startNonce: start, targetNonce: target },
          amountRaw
        );
        const sig = await sendTransactionChecked(connection, tx, wallet, {
          modalLabel: "redeem PT",
        });
        appendDeskActivity({
          kind: "redeem_pt",
          symbol: market.symbol,
          startNonce: start,
          targetNonce: target,
          at: Date.now(),
          signature: sig,
          amount: formatRawAmount(amountRaw, underlyingDecimals),
          amountSymbol: "PT",
        });
        setActivityVersion((v) => v + 1);
        await refreshLegHoldings();
        await refreshWalletBalance();
        setStatus(`PT redeemed · ${sig.slice(0, 8)}…`);
      } catch (err: unknown) {
        console.error(err);
        setStatus(explainTxError(err));
        throw err;
      } finally {
        if (manageBusy) setBusy(false);
      }
    },
    [
      connection,
      market.mint,
      market.symbol,
      refreshLegHoldings,
      refreshWalletBalance,
      wallet,
      underlyingDecimals,
    ]
  );

  const redeemYt = useCallback(
    async (
      start: number,
      target: number,
      amountRaw: bigint,
      opts?: { manageBusy?: boolean }
    ) => {
      if (!wallet.publicKey || !wallet.sendTransaction) {
        setStatus("Connect wallet to redeem YT.");
        return;
      }
      if (amountRaw <= 0n) return;
      const manageBusy = opts?.manageBusy ?? true;
      if (manageBusy) setBusy(true);
      setStatus("Building YT redeem…");
      try {
        const underlying = new PublicKey(market.mint);
        const tx = await buildRedeemYieldTransaction(
          connection,
          wallet.publicKey,
          { underlyingMint: underlying, startNonce: start, targetNonce: target },
          amountRaw
        );
        const sig = await sendTransactionChecked(connection, tx, wallet, {
          modalLabel: "redeem YT",
        });
        appendDeskActivity({
          kind: "redeem_yt",
          symbol: market.symbol,
          startNonce: start,
          targetNonce: target,
          at: Date.now(),
          signature: sig,
          amount: formatRawAmount(amountRaw, underlyingDecimals),
          amountSymbol: "YT",
        });
        setActivityVersion((v) => v + 1);
        await refreshLegHoldings();
        await refreshWalletBalance();
        setStatus(`YT redeemed · ${sig.slice(0, 8)}…`);
      } catch (err: unknown) {
        console.error(err);
        setStatus(explainTxError(err));
        throw err;
      } finally {
        if (manageBusy) setBusy(false);
      }
    },
    [
      connection,
      market.mint,
      market.symbol,
      refreshLegHoldings,
      refreshWalletBalance,
      wallet,
      underlyingDecimals,
    ]
  );

  const exitMaturePosition = useCallback(async () => {
    if (!wallet.publicKey || !wallet.sendTransaction) {
      setStatus("Connect wallet to redeem at maturity.");
      return;
    }
    if (!splitWindowRow?.seriesExists || splitPhase !== "mature") return;
    const { ptRaw, ytRaw } = splitWindowRow;
    if (ptRaw <= 0n && ytRaw <= 0n) return;

    setBusy(true);
    try {
      if (ptRaw > 0n) {
        setStatus("Redeeming PT at maturity…");
        await redeemPt(windowStart, windowTarget, ptRaw, {
          manageBusy: false,
        });
      }
      if (ytRaw > 0n) {
        setStatus("Redeeming YT at maturity…");
        await redeemYt(windowStart, windowTarget, ytRaw, {
          manageBusy: false,
        });
      }
      setStatus(
        `Maturity exit complete · ≈ ${formatRawAmount(splitMatureExitRaw, underlyingDecimals)} ${market.symbol}`
      );
    } catch (err: unknown) {
      console.error(err);
      setStatus(explainTxError(err));
    } finally {
      setBusy(false);
    }
  }, [
    underlyingDecimals,
    market.symbol,
    redeemPt,
    redeemYt,
    splitMatureExitRaw,
    splitPhase,
    splitWindowRow,
    wallet,
    windowStart,
    windowTarget,
  ]);

  const submitSplitUnwrap = useCallback(() => {
    const raw = uiAmountToRaw(unwrapAmount, underlyingDecimals);
    if (raw <= 0n) {
      setStatus("Enter an unwrap amount greater than zero.");
      return;
    }
    const ptRaw = splitWindowRow?.ptRaw ?? 0n;
    const ytRaw = splitWindowRow?.ytRaw ?? 0n;
    if (raw > ptRaw || raw > ytRaw) {
      setStatus(
        `Unwrap burns equal PT + YT — you hold PT ${splitWindowRow?.ptAmount ?? "0"} and YT ${splitWindowRow?.ytAmount ?? "0"}.`
      );
      return;
    }
    void unwrapPosition(windowStart, windowTarget, raw);
  }, [
    underlyingDecimals,
    splitWindowRow,
    unwrapAmount,
    unwrapPosition,
    windowStart,
    windowTarget,
  ]);

  return (
    <>
      <Nav />
      <div className="desk-page">
        <div className="desk-page-veil" aria-hidden />
        <aside className="market-sidebar desk-sidebar desk-sidebar-left">
          <div className="desk-sidebar-head">
            <h3>Markets</h3>
            <input
              className="search-input"
              placeholder="Search symbol…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <div className="sector-tabs">
              <button
                type="button"
                className={`sector-tab ${sector === "All" ? "active" : ""}`}
                onClick={() => setSector("All")}
              >
                All
              </button>
              {SECTORS.map((s) => (
                <button
                  key={s}
                  type="button"
                  className={`sector-tab ${sector === s ? "active" : ""}`}
                  onClick={() => setSector(s)}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
          <div className="desk-sidebar-scroll">
            <div className="market-list">
              {filteredMarkets.map((m) => (
                <button
                  key={m.symbol}
                  type="button"
                  className={`market-item ${m.symbol === symbol ? "active" : ""}`}
                  onClick={() => setSymbol(m.symbol)}
                >
                  <StockLogo symbol={m.symbol} name={m.name} size={28} />
                  <span className="sym">{m.symbol}</span>
                  <span className="market-item-price mono">
                    {formatStockPrice(marketPrices[m.symbol])}
                  </span>
                </button>
              ))}
            </div>
            {filteredMarkets.length === 0 && (
              <p className="hint">No markets match.</p>
            )}
          </div>
        </aside>

        <main className="desk-center">
          <div className="desk-center-inner">
            <div className="desk-workspace">
              <div className="desk-token-bar">
                <div className="desk-token-bar-id">
                  <StockLogo
                    symbol={market.symbol}
                    name={market.name}
                    size={36}
                  />
                  <div className="selected-market-text">
                    <span className="selected-market-sym">{market.symbol}</span>
                    <span className="selected-market-meta">
                      {market.name} · {market.sector}
                      {tradingLabel ? ` · ${tradingLabel}` : ""}
                    </span>
                  </div>
                </div>
                <dl className="desk-token-metrics">
                  <div>
                    <dt>Price</dt>
                    <dd>{formatUsd(intel?.priceUsd ?? null)}</dd>
                  </div>
                  <div>
                    <dt>Mcap</dt>
                    <dd>{formatUsd(intel?.mcapUsd ?? null)}</dd>
                  </div>
                  <div>
                    <dt>Yield</dt>
                    <dd>
                      {trailYield != null
                        ? `${(trailYield * 100).toFixed(2)}%`
                        : "—"}
                    </dd>
                  </div>
                  <div>
                    <dt>Coupon</dt>
                    <dd>{(fairCoupon * 100).toFixed(2)}%</dd>
                  </div>
                  <div>
                    <dt>Tip</dt>
                    <dd className="mono">n{tipNonce}</dd>
                  </div>
                </dl>
              </div>

              <section
                className="desk-card desk-card-primary"
                aria-labelledby="split-heading"
              >
                <div className="desk-primary-grid">
                  <div className="desk-primary-split">
                    <header className="desk-card-head">
                      <span className="desk-card-step" aria-hidden>
                        1
                      </span>
                      <div>
                        <h2 id="split-heading">Split into PT / YT</h2>
                      </div>
                    </header>
                    <div className="desk-card-body desk-split-body">
                      <div className="desk-block desk-block-compact">
                        <div className="split-action-row">
                          <div className="strip-amount-row">
                            <input
                              id="strip-amount"
                              value={amount}
                              onChange={(e) => setAmount(e.target.value)}
                              inputMode="decimal"
                              placeholder="1.0"
                              aria-label={`Split amount in ${market.symbol}`}
                            />
                            <span className="strip-amount-unit">
                              {market.symbol}
                            </span>
                            <button
                              type="button"
                              className="strip-amount-max"
                              disabled={
                                busy ||
                                !wallet.publicKey ||
                                balanceLoading ||
                                !walletBalance ||
                                walletBalance.rawAmount <= 0n
                              }
                              onClick={setMaxAmount}
                            >
                              Max
                            </button>
                          </div>
                          <button
                            className="btn btn-primary split-submit"
                            disabled={busy}
                            onClick={split}
                            type="button"
                          >
                            {busy
                              ? "Working…"
                              : `Split n${windowStart}→n${windowTarget}`}
                          </button>
                          <p className="split-meta hint">
                            {!wallet.publicKey
                              ? "Connect wallet to see balance"
                              : balanceLoading
                                ? "Loading balance…"
                                : `Balance ${walletBalance?.uiAmountString ?? "0"} ${market.symbol}`}
                            {notionalUsd != null
                              ? ` · ≈ ${formatUsd(notionalUsd)}`
                              : ""}
                          </p>
                        </div>
                        <div className="split-window-controls">
                          <label className="desk-field desk-field-inline">
                            <span className="desk-field-label">Start</span>
                            <div className="desk-input-stepper">
                              <button
                                type="button"
                                disabled={busy || windowStart <= tipNonce}
                                onClick={() => onStartSlider(windowStart - 1)}
                                aria-label="Decrease start"
                              >
                                −
                              </button>
                              <input
                                className="desk-input mono"
                                type="number"
                                min={tipNonce}
                                max={startMax}
                                value={windowStart}
                                disabled={busy}
                                onChange={(e) =>
                                  onStartSlider(Number(e.target.value) || tipNonce)
                                }
                              />
                              <button
                                type="button"
                                disabled={busy || windowStart >= startMax}
                                onClick={() => onStartSlider(windowStart + 1)}
                                aria-label="Increase start"
                              >
                                +
                              </button>
                            </div>
                          </label>
                          <span className="split-window-arrow mono" aria-hidden>
                            →
                          </span>
                          <label className="desk-field desk-field-inline">
                            <span className="desk-field-label">Maturity</span>
                            <div className="desk-input-stepper">
                              <button
                                type="button"
                                disabled={busy || lockNonces <= 1}
                                onClick={() => onSpanStep(-1)}
                                aria-label="Decrease maturity"
                              >
                                −
                              </button>
                              <input
                                className="desk-input mono"
                                type="number"
                                min={windowStart + 1}
                                max={windowStart + MAX_SPAN}
                                value={windowTarget}
                                disabled={busy}
                                onChange={(e) =>
                                  onTargetSlider(
                                    Number(e.target.value) || windowStart + 1
                                  )
                                }
                              />
                              <button
                                type="button"
                                disabled={busy || lockNonces >= MAX_SPAN}
                                onClick={() => onSpanStep(1)}
                                aria-label="Increase maturity"
                              >
                                +
                              </button>
                            </div>
                          </label>
                          <span className="split-window-meta hint">
                            {lockNonces}n · tip n{tipNonce}
                            {isForwardWindow ? " · forward" : ""}
                          </span>
                        </div>

                        {splitWindowRow?.seriesExists &&
                        splitPhase !== "mature" &&
                        (splitWindowRow.ptRaw > 0n ||
                          splitWindowRow.ytRaw > 0n) ? (
                          <div className="split-unwrap-block">
                            <p className="split-section-label">
                              Unwrap before maturity
                            </p>
                            {splitWindowRow.ptRaw > 0n &&
                            splitWindowRow.ytRaw > 0n ? (
                              <>
                                <div className="split-action-row">
                                  <div className="strip-amount-row">
                                    <input
                                      value={unwrapAmount}
                                      onChange={(e) =>
                                        setUnwrapAmount(e.target.value)
                                      }
                                      inputMode="decimal"
                                      placeholder="Amount"
                                      aria-label={`Unwrap amount in ${market.symbol}`}
                                      disabled={busy}
                                    />
                                    <span className="strip-amount-unit">
                                      {market.symbol}
                                    </span>
                                  </div>
                                  <button
                                    type="button"
                                    className="btn btn-ghost split-submit"
                                    disabled={
                                      busy ||
                                      !wallet.publicKey ||
                                      !unwrapAmount.trim()
                                    }
                                    onClick={submitSplitUnwrap}
                                  >
                                    {busy
                                      ? "Working…"
                                      : `Unwrap n${windowStart}→n${windowTarget}`}
                                  </button>
                                </div>
                                <p className="split-meta hint">
                                  Burns equal PT + YT · you hold PT{" "}
                                  {splitWindowRow.ptAmount} · YT{" "}
                                  {splitWindowRow.ytAmount}
                                </p>
                              </>
                            ) : (
                              <p className="split-meta hint">
                                Need equal strip PT + strip YT — buy/sell{" "}
                                curve-YT on Meteora or wait for maturity.
                              </p>
                            )}
                          </div>
                        ) : null}

                        {splitWindowRow?.seriesExists &&
                        splitPhase === "mature" &&
                        (splitWindowRow.ptRaw > 0n ||
                          splitWindowRow.ytRaw > 0n) ? (
                          <div className="split-exit-block">
                            <p className="split-section-label">
                              Redeem at maturity
                            </p>
                            <button
                              type="button"
                              className="btn btn-primary split-submit split-exit-btn"
                              disabled={busy || !wallet.publicKey}
                              onClick={() => void exitMaturePosition()}
                            >
                              {busy
                                ? "Working…"
                                : `Redeem all · n${windowStart}→n${windowTarget}`}
                            </button>
                            <p className="split-meta hint">
                              Redeems all PT then all YT in two txs — unequal
                              legs OK (e.g. 1 PT + 150 YT redeems both fully).
                              ≈{" "}
                              {formatRawAmount(
                                splitMatureExitRaw,
                                underlyingDecimals
                              )}{" "}
                              {market.symbol} total · PT {splitWindowRow.ptAmount}{" "}
                              · YT {splitWindowRow.ytAmount}
                            </p>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </div>

                  <StripInspectPanel
                    part="core"
                    connection={connection}
                    symbol={market.symbol}
                    mint={market.mint}
                    tipNonce={tipNonce}
                    underlyingDecimals={walletBalance?.decimals ?? 8}
                    legHoldings={legHoldings}
                    legsLoading={legsLoading}
                    verifiedLaunch={activeLaunch}
                    poolProgress={poolProgress}
                    busy={busy}
                    onRequestPool={requestPool}
                    launchRegisteredOnChain={Boolean(onChainLaunch?.registered)}
                    onSelectInspect={selectInspectWindow}
                    inspectStart={inspectStart}
                    inspectTarget={inspectTarget}
                    inspectSource={inspectSource}
                    onInspectSourceChange={setInspectSource}
                    onManualStartChange={setInspectStart}
                    onManualTargetChange={setInspectTarget}
                    fairCouponForWindow={fairCouponForWindow}
                    rpcEndpoint={connection.rpcEndpoint}
                    onDeskActivity={() => setActivityVersion((v) => v + 1)}
                    onRedeemPt={redeemPt}
                    onRedeemYt={redeemYt}
                  />
                </div>

                <StripInspectPanel
                  part="market"
                  connection={connection}
                  symbol={market.symbol}
                  mint={market.mint}
                  tipNonce={tipNonce}
                  underlyingDecimals={walletBalance?.decimals ?? 8}
                  legHoldings={legHoldings}
                  legsLoading={legsLoading}
                  verifiedLaunch={activeLaunch}
                  poolProgress={poolProgress}
                  busy={busy}
                  onRequestPool={requestPool}
                  launchRegisteredOnChain={Boolean(onChainLaunch?.registered)}
                  onSelectInspect={selectInspectWindow}
                  inspectStart={inspectStart}
                  inspectTarget={inspectTarget}
                  inspectSource={inspectSource}
                  onInspectSourceChange={setInspectSource}
                  onManualStartChange={setInspectStart}
                  onManualTargetChange={setInspectTarget}
                  fairCouponForWindow={fairCouponForWindow}
                  rpcEndpoint={connection.rpcEndpoint}
                  onDeskActivity={() => setActivityVersion((v) => v + 1)}
                />

                <footer className="desk-card-foot" aria-live="polite">
                  {status ||
                    (wallet.publicKey
                      ? registryReady
                        ? `Ready · tip n${tipNonce}`
                        : "Seed registry first."
                      : "Connect wallet")}
                </footer>
              </section>
            </div>

            <DeskActivityLog
              rpcEndpoint={connection.rpcEndpoint}
              symbol={market.symbol}
              activities={symbolActivities}
            />
          </div>
        </main>

        <aside className="ca-sidebar desk-sidebar desk-sidebar-right">
          <div className="desk-sidebar-head">
            <h3>Corporate actions</h3>
            <p className="ca-sidebar-sym">
              <StockLogo symbol={market.symbol} name={market.name} size={22} />
              <span>{market.symbol}</span>
            </p>
          </div>
          <div className="desk-sidebar-scroll">
            {intelLoading && <p className="hint">Loading…</p>}
            {!intelLoading && caRows.length === 0 && (
              <p className="hint">No CA history for {market.symbol}.</p>
            )}
            <div className="ca-list">
              {caRows.map((row) => (
                <article
                  key={`${row.upcoming ? "u" : "h"}-${caRowKey(row)}`}
                  className={`ca-item ${row.upcoming ? "upcoming" : ""}`}
                >
                  <div className="ca-item-top">
                    <div className="ca-type-row">
                      {(() => {
                        const nonce = caNonceByEventId.get(caRowKey(row));
                        if (!nonce) return null;
                        return (
                          <span
                            className={
                              nonce.advancesTip
                                ? "ca-yield-nonce"
                                : "ca-tip-nonce"
                            }
                            title={
                              nonce.advancesTip
                                ? `Yield nonce #${nonce.yieldNonce} — advances registry tip`
                                : `Recorded at tip n${nonce.yieldNonce} — supply/spin-off does not advance tip`
                            }
                          >
                            {nonce.advancesTip
                              ? `#${nonce.yieldNonce}`
                              : `n${nonce.yieldNonce}`}
                          </span>
                        );
                      })()}
                      <span className="ca-type">{row.caType}</span>
                    </div>
                    <span className={`ca-badge ${row.upcoming ? "up" : ""}`}>
                      {row.upcoming ? "Upcoming" : row.status ?? "Recorded"}
                    </span>
                  </div>
                  <div className="ca-date">
                    {formatCaDate(row.effectiveTimeUtc)}
                  </div>
                  <div className="ca-meta">
                    <span>
                      {row.grossCashflowUsd
                        ? formatUsd(Number(row.grossCashflowUsd))
                        : "—"}
                    </span>
                    <span className="mono">
                      {formatMultiplierPair(
                        row.multiplierOld,
                        row.multiplierNew
                      )}
                    </span>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </aside>
      </div>
    </>
  );
}
