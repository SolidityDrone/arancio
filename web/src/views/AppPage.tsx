import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
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
import { YieldNoncePicker } from "../components/YieldNoncePicker";
import {
  buildYieldNonceMaturityMap,
  formatYieldNonceWindowLabel,
} from "../lib/yield-nonce-dates";
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
  launchYieldNonce,
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
import { delayForRpcSettle } from "../lib/rpc-refresh";
import {
  DESK_LIVE_POLL_MS,
  DESK_REGISTRY_POLL_MS,
  shouldPollLiveState,
} from "../lib/live-poll";
import { fetchCurveLaunchState } from "../lib/strip-vault-tx";
import {
  REGISTRY_MISSING_HINT,
  registryPda,
} from "../lib/registry-pda";
import {
  activitiesForSymbol,
  activityYieldNonce,
  appendDeskActivity,
  type DeskActivity,
} from "../lib/desk-activity";
import {
  positionsForSymbol,
  positionYieldNonce,
  saveStripPosition,
} from "../lib/strip-positions";
import { sendTransactionChecked } from "../lib/wallet-tx";
import { isTxDenied } from "../lib/tx-error";
import { formatSimHint } from "../lib/tx-preview";
import {
  formatRawAmount,
  uiAmountToRaw,
  redeemOutputRaw,
  seriesPhase,
} from "../lib/strip-math";
import { fetchWindowCumYs } from "../lib/registry-cum-y";
import {
  buildRedeemCapitalTransaction,
  buildRedeemYieldTransaction,
  buildUnwrapTransaction,
  marketPda,
  ptMintPda,
  seriesPda,
  ytMintPda,
} from "../lib/strip-tx";
import { assignRegistryYieldNonces } from "../lib/registry-nonces";
import {
  avgCashDistributionUsd,
  buildCaListRows,
  caRowKey,
  fetchCorporateActionsForDesk,
  fetchMarketQuotesForDesk,
  fetchPricesUsdForDesk,
  formatStockPrice,
  formatUsd,
  mergeCorporateActions,
  trailingDivYield,
  type CaListRow,
  type CorporateAction,
  type MarketIntel,
} from "../lib/xstocks-api";
import idl from "../lib/divstrip.json";

const PROGRAM_ID = new PublicKey(DIVSTRIP_PROGRAM_ID);

/** How far ahead of tip a yield nonce may be opened. */
const MAX_FORWARD = 8;

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

const SINGLE_NONCE_LOCK = 1;

function fairCouponFromYieldEvents(
  events: CorporateAction[],
  chainCumY: bigint | null
): number | null {
  if (events.length === 0) return null;
  const slice = events.slice(-SINGLE_NONCE_LOCK);
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

function fairCouponFromChain(chainCumY: bigint | null): number {
  const cumStart =
    chainCumY && chainCumY > 0n ? chainCumY : MULTIPLIER_SCALE;
  const target = BigInt(
    Math.floor(Number(cumStart) * (1 + 0.004 * SINGLE_NONCE_LOCK))
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
  const searchParams = useSearchParams();
  const [symbol, setSymbol] = useState("KOx");
  const [search, setSearch] = useState("");
  const [sector, setSector] = useState<MarketSector | "All">("All");
  const [amount, setAmount] = useState("1");
  const [unwrapAmount, setUnwrapAmount] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [tipNonce, setTipNonce] = useState(0);
  const [yieldNonce, setYieldNonce] = useState(0);
  const [chainCumY, setChainCumY] = useState<bigint | null>(null);
  const [registryReady, setRegistryReady] = useState(false);
  const [onchainEvents, setOnchainEvents] = useState(0);
  const [launches, setLaunches] = useState<StoredLaunch[]>([]);
  const [verifiedLaunch, setVerifiedLaunch] = useState<StoredLaunch | null>(null);
  const [onChainLaunch, setOnChainLaunch] = useState<
    Awaited<ReturnType<typeof fetchCurveLaunchState>> | null
  >(null);
  const [launchRefresh, setLaunchRefresh] = useState(0);
  const [deskRefreshKey, setDeskRefreshKey] = useState(0);
  const [poolProgress, setPoolProgress] = useState<{
    quoteProgress: number;
    isMigrated: boolean;
  } | null>(null);
  const [intel, setIntel] = useState<MarketIntel | null>(null);
  const [intelLoading, setIntelLoading] = useState(false);
  const [intelError, setIntelError] = useState<string | null>(null);
  const [caLoading, setCaLoading] = useState(false);
  const [caError, setCaError] = useState<string | null>(null);
  const [caLoadedSymbol, setCaLoadedSymbol] = useState<string | null>(null);
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
  const [symbolActivities, setSymbolActivities] = useState<DeskActivity[]>([]);
  const [inspectNonce, setInspectNonce] = useState(0);

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

  const isForwardNonce = yieldNonce > tipNonce;
  const nonceMax = tipNonce + MAX_FORWARD;
  const underlyingDecimals = walletBalance?.decimals ?? 8;

  const splitSeriesRow = useMemo(
    () =>
      legHoldings.find((r) => r.yieldNonce === yieldNonce) ?? null,
    [legHoldings, yieldNonce]
  );

  const splitPhase = seriesPhase(tipNonce, yieldNonce);

  const [splitCums, setSplitCums] = useState({
    cumStart: MULTIPLIER_SCALE,
    cumTarget: MULTIPLIER_SCALE,
  });

  useEffect(() => {
    setUnwrapAmount("");
  }, [yieldNonce, market.symbol]);

  useEffect(() => {
    if (!splitSeriesRow?.seriesExists || splitPhase !== "mature") return;
    let cancelled = false;
    (async () => {
      try {
        const underlying = new PublicKey(market.mint);
        const marketKey = marketPda(underlying);
        const series = seriesPda(marketKey, yieldNonce);
        const seriesInfo = await connection.getAccountInfo(series);
        const cums = await fetchWindowCumYs(
          connection,
          underlying,
          yieldNonce,
          yieldNonce + 1,
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
    splitSeriesRow?.seriesExists,
    yieldNonce,
  ]);

  const splitPtRedeemRaw = redeemOutputRaw(
    splitSeriesRow?.ptRaw ?? 0n,
    splitCums.cumStart,
    splitCums.cumTarget,
    true
  );
  const splitYtRedeemRaw = redeemOutputRaw(
    splitSeriesRow?.ytRaw ?? 0n,
    splitCums.cumStart,
    splitCums.cumTarget,
    false
  );
  const splitMatureExitRaw = splitPtRedeemRaw + splitYtRedeemRaw;

  const fairCoupon = useMemo(() => {
    const fromIntel = intel
      ? fairCouponFromYieldEvents(intel.yieldEvents, chainCumY)
      : null;
    if (fromIntel != null) return fromIntel;
    return fairCouponFromChain(chainCumY);
  }, [intel, chainCumY]);

  const fairCouponForNonce = useCallback(
    (_yieldNonce: number) => {
      const fromIntel = intel
        ? fairCouponFromYieldEvents(intel.yieldEvents, chainCumY)
        : null;
      if (fromIntel != null) return fromIntel;
      return fairCouponFromChain(chainCumY);
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

  useEffect(() => {
    const acts = activitiesForSymbol(market.symbol);
    setSymbolActivities(
      acts.map((a) => {
        if (a.pool) return a;
        const launch = launches.find(
          (l) =>
            l.symbol === a.symbol &&
            launchYieldNonce(l) === activityYieldNonce(a)
        );
        if (!launch) return a;
        return {
          ...a,
          pool: launch.pool,
          baseMint: launch.baseMint,
          quoteMint: launch.quoteMint,
        };
      })
    );
  }, [market.symbol, activityVersion, launches]);

  const caNonceByEventId = useMemo(() => {
    if (caLoading || caLoadedSymbol !== symbol || !intel) {
      return new Map<string, { yieldNonce: number; advancesTip: boolean }>();
    }
    return assignRegistryYieldNonces(
      mergeCorporateActions(intel.history, intel.upcoming)
    );
  }, [intel, symbol, caLoading, caLoadedSymbol]);

  const caRows = useMemo((): CaListRow[] => {
    if (caLoading || caLoadedSymbol !== symbol || !intel) return [];
    return buildCaListRows(intel.history, intel.upcoming);
  }, [intel, symbol, caLoading, caLoadedSymbol]);

  const marketDataReady = caLoadedSymbol === symbol && !caLoading;

  const deskAvgDistributionUsd = useMemo(() => {
    if (!marketDataReady) return null;
    return avgCashDistributionUsd(intel?.history ?? []) ?? null;
  }, [intel?.history, marketDataReady]);

  const yieldNonceSchedule = useMemo(
    () => buildYieldNonceMaturityMap(caRows),
    [caRows]
  );

  const splitWindowLabel = useMemo(
    () => formatYieldNonceWindowLabel(yieldNonce, yieldNonceSchedule),
    [yieldNonce, yieldNonceSchedule]
  );

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
    setYieldNonce((prev) => Math.max(tip, Math.min(prev, tip + MAX_FORWARD)));
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
      const seen = new Set<number>();
      const nonces: number[] = [];

      const addNonce = (nonce: number) => {
        if (seen.has(nonce)) return;
        seen.add(nonce);
        nonces.push(nonce);
      };

      addNonce(yieldNonce);
      for (const p of positionsForSymbol(market.symbol)) {
        addNonce(positionYieldNonce(p));
      }

      const rows = await Promise.all(
        nonces.map(async (nonce) => {
          const series = seriesPda(marketKey, nonce);
          const seriesInfo = await connection.getAccountInfo(series);
          if (!seriesInfo) {
            return {
              yieldNonce: nonce,
              seriesExists: false,
              ptAmount: "0",
              ytAmount: "0",
              ptRaw: 0n,
              ytRaw: 0n,
            };
          }
          const ptMint = ptMintPda(marketKey, nonce);
          const ytMint = ytMintPda(marketKey, nonce);
          const [pt, yt] = await Promise.all([
            fetchSplBalance(connection, ptMint, wallet.publicKey!),
            fetchSplBalance(connection, ytMint, wallet.publicKey!),
          ]);
          return {
            yieldNonce: nonce,
            seriesExists: true,
            ptAmount: formatRawAmount(pt.raw, underlyingDecimals),
            ytAmount: formatRawAmount(yt.raw, underlyingDecimals),
            ptRaw: pt.raw,
            ytRaw: yt.raw,
          };
        })
      );

      rows.sort((a, b) => b.yieldNonce - a.yieldNonce);
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
    yieldNonce,
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

  const refreshAfterTx = useCallback(async () => {
    await delayForRpcSettle();
    await Promise.all([
      refreshRegistry(),
      refreshWalletBalance(),
      refreshLegHoldings(),
    ]);
    setDeskRefreshKey((k) => k + 1);
  }, [refreshRegistry, refreshWalletBalance, refreshLegHoldings]);

  const onNonceSlider = (raw: number) => {
    setYieldNonce(Math.max(tipNonce, Math.min(nonceMax, raw)));
  };

  useEffect(() => {
    setLaunches(loadLaunches());
    setActivityVersion((v) => v + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const prices = await fetchPricesUsdForDesk(
          MARKETS.map((m) => m.symbol)
        );
        if (!cancelled) setMarketPrices(prices);
      } catch {
        if (!cancelled) setMarketPrices({});
      }
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
    const nonceParam =
      searchParams.get("nonce") ?? searchParams.get("start");
    if (sym && MARKETS.some((m) => m.symbol === sym)) {
      setSymbol(sym);
    }
    if (nonceParam != null) {
      const n = parseInt(nonceParam, 10);
      if (Number.isFinite(n) && n >= 0) {
        setYieldNonce(n);
        setInspectNonce(n);
      }
    }
  }, [searchParams]);

  useEffect(() => {
    const urlSym = searchParams.get("symbol");
    const nonceParam =
      searchParams.get("nonce") ?? searchParams.get("start");
    if (urlSym === symbol && nonceParam != null) {
      return;
    }
    setYieldNonce(0);
    setInspectNonce(0);
  }, [symbol, searchParams]);

  useEffect(() => {
    void refreshWalletBalance();
  }, [refreshWalletBalance]);

  useEffect(() => {
    void refreshLegHoldings();
  }, [refreshLegHoldings]);

  useEffect(() => {
    let cancelled = false;
    setCaLoading(true);
    setCaError(null);
    setCaLoadedSymbol(null);
    setIntel((prev) =>
      prev
        ? { ...prev, history: [], upcoming: [], yieldEvents: [] }
        : prev
    );
    void (async () => {
      try {
        const ca = await fetchCorporateActionsForDesk(symbol);
        if (cancelled) return;
        setIntel((prev) => ({
          asset: prev?.asset ?? null,
          priceUsd: prev?.priceUsd ?? null,
          circulatingSupply: prev?.circulatingSupply ?? null,
          totalSupply: prev?.totalSupply ?? null,
          mcapUsd: prev?.mcapUsd ?? null,
          ...ca,
        }));
        setCaLoadedSymbol(symbol);
      } catch (err) {
        if (!cancelled) {
          setCaError(
            err instanceof Error ? err.message : "Corporate actions failed"
          );
        }
      } finally {
        if (!cancelled) setCaLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [symbol]);

  useEffect(() => {
    let cancelled = false;
    setIntelLoading(true);
    setIntelError(null);
    void (async () => {
      try {
        const quotes = await fetchMarketQuotesForDesk(symbol);
        if (cancelled) return;
        setIntel((prev) => ({
          ...quotes,
          history: prev?.history ?? [],
          upcoming: prev?.upcoming ?? [],
          yieldEvents: prev?.yieldEvents ?? [],
        }));
      } catch (err) {
        if (!cancelled) {
          setIntelError(
            err instanceof Error ? err.message : "xStocks market data failed"
          );
        }
      } finally {
        if (!cancelled) setIntelLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [symbol]);

  useEffect(() => {
    setInspectNonce(yieldNonce);
  }, [symbol, yieldNonce]);

  useEffect(() => {
    setVerifiedLaunch(null);
    setPoolProgress(null);
    setOnChainLaunch(null);
  }, [market.mint, market.symbol, inspectNonce]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const underlying = new PublicKey(market.mint);
      const chain = await fetchCurveLaunchState(connection, {
        underlyingMint: underlying,
        yieldNonce: inspectNonce,
      });
      if (cancelled) return;
      setOnChainLaunch(chain);

      const local = launches.find(
        (l) =>
          l.symbol === market.symbol &&
          launchYieldNonce(l) === inspectNonce
      );

      const inspectFair = fairCouponForNonce(inspectNonce);
      let launch: StoredLaunch | null = null;

      if (chain.registered && chain.pool && chain.curveYtMint) {
        const poolMatch = local?.pool === chain.pool.toBase58();
        launch = poolMatch
          ? local!
          : {
              symbol: market.symbol,
              yieldNonce: inspectNonce,
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
    fairCouponForNonce,
    inspectNonce,
    launchRefresh,
    deskRefreshKey,
    launches,
    market.mint,
    market.symbol,
  ]);

  const activeLaunch = verifiedLaunch;

  const refreshPoolProgressLive = useCallback(async () => {
    const pool = verifiedLaunch?.pool;
    if (!pool || !shouldPollLiveState()) return;
    try {
      const progress = await fetchPoolProgress(connection, new PublicKey(pool));
      if (progress) {
        setPoolProgress({
          quoteProgress: progress.quoteProgress,
          isMigrated: progress.isMigrated,
        });
      }
    } catch {
      /* keep last snapshot */
    }
  }, [connection, verifiedLaunch?.pool]);

  useEffect(() => {
    if (!verifiedLaunch?.pool) return;
    void refreshPoolProgressLive();
    const id = window.setInterval(
      () => void refreshPoolProgressLive(),
      DESK_LIVE_POLL_MS
    );
    const onVisible = () => {
      if (shouldPollLiveState()) void refreshPoolProgressLive();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [verifiedLaunch?.pool, refreshPoolProgressLive]);

  useEffect(() => {
    void refreshRegistry();
    const id = window.setInterval(() => {
      if (shouldPollLiveState()) void refreshRegistry();
    }, DESK_REGISTRY_POLL_MS);
    const onVisible = () => {
      if (shouldPollLiveState()) void refreshRegistry();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refreshRegistry]);

  const selectInspectNonce = useCallback((nonce: number) => {
    setInspectNonce(nonce);
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
      const registry = registryPda(underlying);

      const registryInfo = await connection.getAccountInfo(registry);
      if (!registryInfo) {
        throw new Error(
          `No ca_registry for ${market.symbol}. ${REGISTRY_MISSING_HINT}`
        );
      }

      const tip = readYieldNonce(registryInfo.data);
      applyTip(tip);
      const nonce = Math.max(tip, Math.min(yieldNonce, tip + MAX_FORWARD));
      if (nonce > tip + MAX_FORWARD) {
        throw new Error(`Yield nonce max is tip + ${MAX_FORWARD} (n${tip + MAX_FORWARD}).`);
      }

      let marketInfo = await connection.getAccountInfo(marketKey);
      if (!marketInfo) {
        setStatus(
          "Confirm signature 1/2: initialize strip market (one-time per xStock)…"
        );
        const vaultAuthInit = vaultAuthority(marketKey);
        const initTx = await program.methods
          .initializeStrip(market.symbol, MAX_FORWARD)
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

      const series = seriesPda(marketKey, nonce);
      const ptMint = ptMintPda(marketKey, nonce);
      const ytMint = ytMintPda(marketKey, nonce);
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
            .createSeries(nonce)
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
      selectInspectNonce(nonce);
      setYieldNonce(nonce);

      const splitAmount = amount.trim() || amountNum.toString();
      saveStripPosition({
        symbol: market.symbol,
        yieldNonce: nonce,
        splitAt: Date.now(),
        signature: sig,
        amount: splitAmount,
      });
      appendDeskActivity({
        kind: "split",
        symbol: market.symbol,
        yieldNonce: nonce,
        at: Date.now(),
        signature: sig,
        amount: splitAmount,
        amountSymbol: market.symbol,
      });
      setPositionsVersion((v) => v + 1);
      setActivityVersion((v) => v + 1);
      await refreshAfterTx();
      setStatus(
        `Split confirmed · n${nonce} · ${sig.slice(0, 8)}… — launch curve-YT pool on Meteora next`
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
    market,
    refreshAfterTx,
    selectInspectNonce,
    wallet,
    walletBalance,
    underlyingDecimals,
    yieldNonce,
  ]);

  const requestPool = useCallback(async () => {
    setBusy(true);
    setStatus("Checking registry…");
    try {
      const nonce = inspectNonce;
      const nonceFair = fairCouponForNonce(nonce);
      const avgDist =
        avgCashDistributionUsd(intel?.history ?? []) ?? undefined;
      if (avgDist == null || avgDist <= 0) {
        setStatus(
          `Cannot launch curve-YT for ${market.symbol}: no xStocks CashDividend history to price the band.`
        );
        return;
      }

      if (!registryReady) {
        setStatus(
          `No ca_registry for ${market.symbol}. ${REGISTRY_MISSING_HINT}`
        );
        return;
      }

      setStatus("Requesting pool launch (Meteora + register + vault)…");
      const apiRes = await requestPoolLaunch({
        mint: market.mint,
        symbol: market.symbol,
        yieldNonce: nonce,
        fairCoupon: nonceFair,
        avgDistributionUsd: avgDist,
      });

      const stored = storedLaunchFromApi(
        {
          mint: market.mint,
          symbol: market.symbol,
          yieldNonce: nonce,
          fairCoupon: nonceFair,
          avgDistributionUsd: avgDist,
        },
        apiRes
      );
      if (!stored) {
        throw new Error(
          apiRes.executorStatus ??
            "Launch finished without pool metadata — check server logs."
        );
      }

      saveLaunch(stored);
      appendDeskActivity({
        kind: "dbc_launch",
        symbol: market.symbol,
        yieldNonce: nonce,
        at: Date.now(),
        signature: apiRes.launchSignature ?? "",
        pool: stored.pool,
        baseMint: stored.baseMint,
        quoteMint: stored.quoteMint,
      });
      setLaunches(loadLaunches());
      setActivityVersion((v) => v + 1);
      setLaunchRefresh((v) => v + 1);
      await delayForRpcSettle(600);
      setDeskRefreshKey((k) => k + 1);
      setStatus(
        `curve-YT pool live · ${stored.pool.slice(0, 8)}… · registered ${(apiRes.registerSignature ?? "").slice(0, 8)}…`
      );
    } catch (err: unknown) {
      console.error(err);
      const msg = err instanceof Error ? err.message : String(err);
      setStatus(
        /fetch|Failed to fetch|NetworkError/i.test(msg)
          ? "Launch API unreachable — run npm run dev and set SOLANA_KEYPAIR_PATH (see README)."
          : explainTxError(err)
      );
    } finally {
      setBusy(false);
    }
  }, [
    applyTip,
    connection,
    fairCouponForNonce,
    inspectNonce,
    intel?.history,
    market.mint,
    market.symbol,
    registryReady,
  ]);

  const unwrapPosition = useCallback(
    async (nonce: number, amountRaw: bigint) => {
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
          { underlyingMint: underlying, yieldNonce: nonce },
          amountRaw
        );
        const sig = await sendTransactionChecked(connection, tx, wallet, {
          modalLabel: "unwrap",
        });
        const ui = formatRawAmount(amountRaw, underlyingDecimals);
        appendDeskActivity({
          kind: "unwrap",
          symbol: market.symbol,
          yieldNonce: nonce,
          at: Date.now(),
          signature: sig,
          amount: ui,
          amountSymbol: market.symbol,
        });
        setActivityVersion((v) => v + 1);
        setPositionsVersion((v) => v + 1);
        await refreshAfterTx();
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
      refreshAfterTx,
      wallet,
      underlyingDecimals,
    ]
  );

  const redeemPt = useCallback(
    async (
      nonce: number,
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
          { underlyingMint: underlying, yieldNonce: nonce },
          amountRaw
        );
        const sig = await sendTransactionChecked(connection, tx, wallet, {
          modalLabel: "redeem PT",
        });
        appendDeskActivity({
          kind: "redeem_pt",
          symbol: market.symbol,
          yieldNonce: nonce,
          at: Date.now(),
          signature: sig,
          amount: formatRawAmount(amountRaw, underlyingDecimals),
          amountSymbol: "PT",
        });
        setActivityVersion((v) => v + 1);
        setPositionsVersion((v) => v + 1);
        await refreshAfterTx();
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
      refreshAfterTx,
      wallet,
      underlyingDecimals,
    ]
  );

  const redeemYt = useCallback(
    async (
      nonce: number,
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
          { underlyingMint: underlying, yieldNonce: nonce },
          amountRaw
        );
        const sig = await sendTransactionChecked(connection, tx, wallet, {
          modalLabel: "redeem YT",
        });
        appendDeskActivity({
          kind: "redeem_yt",
          symbol: market.symbol,
          yieldNonce: nonce,
          at: Date.now(),
          signature: sig,
          amount: formatRawAmount(amountRaw, underlyingDecimals),
          amountSymbol: "YT",
        });
        setActivityVersion((v) => v + 1);
        setPositionsVersion((v) => v + 1);
        await refreshAfterTx();
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
      refreshAfterTx,
      wallet,
      underlyingDecimals,
    ]
  );

  const exitMaturePosition = useCallback(async () => {
    if (!wallet.publicKey || !wallet.sendTransaction) {
      setStatus("Connect wallet to redeem at maturity.");
      return;
    }
    if (!splitSeriesRow?.seriesExists || splitPhase !== "mature") return;
    const { ptRaw, ytRaw } = splitSeriesRow;
    if (ptRaw <= 0n && ytRaw <= 0n) return;

    setBusy(true);
    try {
      if (ptRaw > 0n) {
        setStatus("Redeeming PT at maturity…");
        await redeemPt(yieldNonce, ptRaw, {
          manageBusy: false,
        });
      }
      if (ytRaw > 0n) {
        setStatus("Redeeming YT at maturity…");
        await redeemYt(yieldNonce, ytRaw, {
          manageBusy: false,
        });
      }
      setActivityVersion((v) => v + 1);
      setPositionsVersion((v) => v + 1);
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
    splitSeriesRow,
    wallet,
    yieldNonce,
  ]);

  const submitSplitUnwrap = useCallback(() => {
    const raw = uiAmountToRaw(unwrapAmount, underlyingDecimals);
    if (raw <= 0n) {
      setStatus("Enter an unwrap amount greater than zero.");
      return;
    }
    const ptRaw = splitSeriesRow?.ptRaw ?? 0n;
    const ytRaw = splitSeriesRow?.ytRaw ?? 0n;
    if (raw > ptRaw || raw > ytRaw) {
      setStatus(
        `Unwrap burns equal PT + YT — you hold PT ${splitSeriesRow?.ptAmount ?? "0"} and YT ${splitSeriesRow?.ytAmount ?? "0"}.`
      );
      return;
    }
    void unwrapPosition(yieldNonce, raw);
  }, [
    underlyingDecimals,
    splitSeriesRow,
    unwrapAmount,
    unwrapPosition,
    yieldNonce,
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
              <div
                className={`desk-token-bar${intelLoading ? " is-loading" : ""}`}
              >
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
                      <span className="selected-market-trading">
                        {tradingLabel ? ` · ${tradingLabel}` : ""}
                      </span>
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
                            {busy ? "Working…" : `Split ${splitWindowLabel}`}
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
                          <label className="desk-field" htmlFor="split-yield-nonce">
                            <span className="desk-field-label">Strip window</span>
                            <YieldNoncePicker
                              id="split-yield-nonce"
                              tipNonce={tipNonce}
                              nonceMax={nonceMax}
                              value={yieldNonce}
                              caRows={caRows}
                              datesLoading={caLoading || caLoadedSymbol !== symbol}
                              disabled={busy}
                              onChange={onNonceSlider}
                            />
                          </label>
                          <span className="split-window-meta hint">
                            Tip N{tipNonce}
                            {isForwardNonce ? " · forward window" : ""}
                          </span>
                        </div>

                        {splitSeriesRow?.seriesExists &&
                        splitPhase !== "mature" &&
                        (splitSeriesRow.ptRaw > 0n ||
                          splitSeriesRow.ytRaw > 0n) ? (
                          <div className="split-unwrap-block">
                            <p className="split-section-label">
                              Unwrap before maturity
                            </p>
                            {splitSeriesRow.ptRaw > 0n &&
                            splitSeriesRow.ytRaw > 0n ? (
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
                                      : `Unwrap n${yieldNonce}`}
                                  </button>
                                </div>
                                <p className="split-meta hint">
                                  Burns equal PT + YT · you hold PT{" "}
                                  {splitSeriesRow.ptAmount} · YT{" "}
                                  {splitSeriesRow.ytAmount}
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

                        {splitSeriesRow?.seriesExists &&
                        splitPhase === "mature" &&
                        (splitSeriesRow.ptRaw > 0n ||
                          splitSeriesRow.ytRaw > 0n) ? (
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
                                : `Redeem all · n${yieldNonce}`}
                            </button>
                            <p className="split-meta hint">
                              Redeems all PT then all YT in two txs — unequal
                              legs OK (e.g. 1 PT + 150 YT redeems both fully).
                              ≈{" "}
                              {formatRawAmount(
                                splitMatureExitRaw,
                                underlyingDecimals
                              )}{" "}
                              {market.symbol} total · PT {splitSeriesRow.ptAmount}{" "}
                              · YT {splitSeriesRow.ytAmount}
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
                    marketDataReady={marketDataReady}
                    busy={busy}
                    onRequestPool={requestPool}
                    launchRegisteredOnChain={Boolean(onChainLaunch?.registered)}
                    onSelectInspect={selectInspectNonce}
                    inspectNonce={inspectNonce}
                    fairCouponForNonce={fairCouponForNonce}
                    caRows={caRows}
                    avgDistributionUsd={deskAvgDistributionUsd}
                    rpcEndpoint={connection.rpcEndpoint}
                    deskRefreshKey={deskRefreshKey}
                    onDeskActivity={() => setActivityVersion((v) => v + 1)}
                    onTxConfirmed={() => refreshAfterTx()}
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
                  marketDataReady={marketDataReady}
                  busy={busy}
                  onRequestPool={requestPool}
                  launchRegisteredOnChain={Boolean(onChainLaunch?.registered)}
                  onSelectInspect={selectInspectNonce}
                  inspectNonce={inspectNonce}
                  fairCouponForNonce={fairCouponForNonce}
                  caRows={marketDataReady ? caRows : []}
                  avgDistributionUsd={deskAvgDistributionUsd}
                  rpcEndpoint={connection.rpcEndpoint}
                  deskRefreshKey={deskRefreshKey}
                  onDeskActivity={() => setActivityVersion((v) => v + 1)}
                  onTxConfirmed={() => refreshAfterTx()}
                />

                <footer className="desk-card-foot" aria-live="polite">
                  {status ||
                    (wallet.publicKey
                      ? registryReady
                        ? `Ready · tip n${tipNonce}`
                        : "Registry missing — run deploy-surfpool.sh"
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
          <div className="desk-sidebar-scroll ca-sidebar-scroll">
            <div className="ca-status-slot" aria-live="polite">
              {caLoading ? (
                <span className="ca-status-text">Loading…</span>
              ) : caError ? (
                <span className="ca-status-text ca-sidebar-error">{caError}</span>
              ) : caRows.length === 0 ? (
                <span className="ca-status-text">
                  No CA history for {market.symbol}.
                </span>
              ) : null}
            </div>
            <div className={`ca-list${caLoading ? " ca-list-loading" : ""}`}>
              {caLoading
                ? Array.from({ length: 5 }, (_, i) => (
                    <article
                      key={`ca-skel-${i}`}
                      className="ca-item ca-item-skeleton"
                      aria-hidden
                    />
                  ))
                : caRows.map((row) => (
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
                        <span
                          className={`ca-badge ${row.upcoming ? "up" : ""}`}
                        >
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
