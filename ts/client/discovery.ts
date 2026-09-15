import { createHash } from "crypto";
import * as https from "https";
import { Connection, PublicKey } from "@solana/web3.js";

export type ReserveDescriptor = {
  market: PublicKey;
  reserve: PublicKey;
  liquidityMint: PublicKey;
  collateralMint: PublicKey;
  oracle: PublicKey;
  tokenProgram: PublicKey;
  supplyEnabled: boolean;
};

export type ReserveComponentIdentity = {
  market: PublicKey;
  liquidityMint: PublicKey;
  collateralMint: PublicKey;
  oracle: PublicKey;
  tokenProgram: PublicKey;
};

type U64Parts = { high: number; low: number };
type ApiReserve = { reserve?: unknown };

const ACCOUNT_DISCRIMINATOR_BYTES = 8;
const PUBLIC_KEY_BYTES = 32;
const U64_BYTES = 8;
const U128_BYTES = 16;
const FRACTION_SCALE = 1n << 60n;
const RESERVE_DISCRIMINATOR = createHash("sha256")
  .update("account:Reserve")
  .digest()
  .subarray(0, ACCOUNT_DISCRIMINATOR_BYTES);

const LAST_UPDATE_BYTES = 16;
const LIQUIDITY_FIELDS_BYTES =
  PUBLIC_KEY_BYTES * 3 +
  U64_BYTES +
  U128_BYTES * 2 +
  U64_BYTES * 4 +
  U64_BYTES * 6 +
  U128_BYTES * 4 +
  PUBLIC_KEY_BYTES +
  U64_BYTES * 51 +
  U128_BYTES * 32;
const LIQUIDITY_PADDING_BYTES = U64_BYTES * 150;
const COLLATERAL_FIELDS_BYTES =
  PUBLIC_KEY_BYTES + U64_BYTES + PUBLIC_KEY_BYTES + U128_BYTES * 64;
const COLLATERAL_PADDING_BYTES = U64_BYTES * 150;
const CONFIG_PREFIX_BYTES = 4 + 10 + 4 + 6 + 16 + 24 + 88 + U64_BYTES * 3;
const TOKEN_INFO_SCOPE_OFFSET = 32 + 24 + U64_BYTES * 3;
const TOKEN_INFO_SWITCHBOARD_OFFSET = TOKEN_INFO_SCOPE_OFFSET + 48;
const TOKEN_INFO_PYTH_OFFSET = TOKEN_INFO_SWITCHBOARD_OFFSET + 64;

const reserveLiquidityOffset =
  ACCOUNT_DISCRIMINATOR_BYTES +
  U64_BYTES +
  LAST_UPDATE_BYTES +
  PUBLIC_KEY_BYTES * 3;
const reserveCollateralOffset =
  reserveLiquidityOffset + LIQUIDITY_FIELDS_BYTES + LIQUIDITY_PADDING_BYTES;
const reserveConfigOffset =
  reserveCollateralOffset + COLLATERAL_FIELDS_BYTES + COLLATERAL_PADDING_BYTES;
const RESERVE_ACCOUNT_BYTES = 8624;

const readU64 = (data: Buffer, offset: number): U64Parts => ({
  low: data.readUInt32LE(offset),
  high: data.readUInt32LE(offset + 4),
});

const isZero = (value: U64Parts) => value.low === 0 && value.high === 0;

const compareU64 = (left: U64Parts, right: U64Parts) =>
  left.high === right.high ? left.low - right.low : left.high - right.high;

const readPublicKey = (data: Buffer, offset: number) =>
  new PublicKey(data.subarray(offset, offset + PUBLIC_KEY_BYTES));

const readU128 = (data: Buffer, offset: number): bigint => {
  let value = 0n;
  for (let index = U128_BYTES - 1; index >= 0; index -= 1) {
    value = (value << 8n) | BigInt(data[offset + index]);
  }
  return value;
};

const isDefaultPublicKey = (value: PublicKey) =>
  value.equals(PublicKey.default);

// Kamino uses an all-ones pubkey for an unset optional oracle.
const KAMINO_NULL_ORACLE = new PublicKey(new Uint8Array(32).fill(0xff));

const isUnsetOracle = (value: PublicKey) =>
  isDefaultPublicKey(value) || value.equals(KAMINO_NULL_ORACLE);

const getJson = (url: string): Promise<unknown> =>
  new Promise((resolve, reject) => {
    https
      .get(url, (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          body += chunk;
        });
        response.on("end", () => {
          if (response.statusCode !== 200) {
            reject(
              new Error(`Kamino API returned HTTP ${response.statusCode}`)
            );
            return;
          }
          try {
            resolve(JSON.parse(body));
          } catch (error) {
            reject(new Error(`Kamino API returned invalid JSON: ${error}`));
          }
        });
      })
      .on("error", reject);
  });

const fetchCandidateReserves = async (market: PublicKey) => {
  const apiBase =
    process.env.ARANCIO_KAMINO_API_URL ?? "https://api.kamino.finance";
  const response = await getJson(
    `${apiBase}/kamino-market/${market.toBase58()}/reserves/metrics`
  );
  if (!Array.isArray(response)) {
    throw new Error("Kamino API returned an unexpected reserve list");
  }

  const candidates: PublicKey[] = [];
  for (const value of response as ApiReserve[]) {
    if (typeof value.reserve !== "string") {
      continue;
    }
    try {
      candidates.push(new PublicKey(value.reserve));
    } catch {
      continue;
    }
  }
  return Array.from(
    new Map(
      candidates.map((candidate) => [candidate.toBase58(), candidate])
    ).values()
  );
};

const decodeReserve = (
  data: Buffer,
  market: PublicKey,
  reserve: PublicKey,
  programOwner: PublicKey
): ReserveDescriptor | null => {
  if (
    data.length < RESERVE_ACCOUNT_BYTES ||
    !data.subarray(0, ACCOUNT_DISCRIMINATOR_BYTES).equals(RESERVE_DISCRIMINATOR)
  ) {
    return null;
  }

  const liveMarket = readPublicKey(
    data,
    ACCOUNT_DISCRIMINATOR_BYTES + U64_BYTES + LAST_UPDATE_BYTES
  );
  if (!liveMarket.equals(market)) {
    return null;
  }

  const liquidityMint = readPublicKey(data, reserveLiquidityOffset);
  const tokenProgram = readPublicKey(data, reserveLiquidityOffset + 280);
  const collateralMint = readPublicKey(data, reserveCollateralOffset);
  const status = data[reserveConfigOffset];
  const depositLimit = BigInt(readU64(data, reserveConfigOffset + 160).low);
  const depositLimitCrossed = readU64(data, reserveLiquidityOffset + 152);
  const availableAmount = BigInt(readU64(data, reserveLiquidityOffset + 96).low);
  const totalSupply =
    availableAmount * FRACTION_SCALE +
    readU128(data, reserveLiquidityOffset + 104) -
    readU128(data, reserveLiquidityOffset + 216) -
    readU128(data, reserveLiquidityOffset + 232) -
    readU128(data, reserveLiquidityOffset + 248);

  const oracleCandidates = [
    readPublicKey(
      data,
      reserveConfigOffset + CONFIG_PREFIX_BYTES + TOKEN_INFO_SCOPE_OFFSET
    ),
    readPublicKey(
      data,
      reserveConfigOffset + CONFIG_PREFIX_BYTES + TOKEN_INFO_SWITCHBOARD_OFFSET
    ),
    readPublicKey(
      data,
      reserveConfigOffset + CONFIG_PREFIX_BYTES + TOKEN_INFO_PYTH_OFFSET
    ),
  ];
  const oracle = oracleCandidates.find(
    (candidate) => !isUnsetOracle(candidate)
  );
  if (
    !oracle ||
    isDefaultPublicKey(liquidityMint) ||
    isDefaultPublicKey(collateralMint)
  ) {
    return null;
  }

  const supplyEnabled =
    status === 0 &&
    totalSupply < depositLimit * FRACTION_SCALE &&
    isZero(depositLimitCrossed) &&
    !isDefaultPublicKey(tokenProgram) &&
    !programOwner.equals(PublicKey.default);

  return {
    market,
    reserve,
    liquidityMint,
    collateralMint,
    oracle,
    tokenProgram,
    supplyEnabled,
  };
};

export async function discoverSupplyReserves(
  connection: Connection,
  market: PublicKey
): Promise<ReserveDescriptor[]> {
  const [marketAccount, candidates] = await Promise.all([
    connection.getAccountInfo(market, "confirmed"),
    fetchCandidateReserves(market),
  ]);
  if (!marketAccount) {
    throw new Error(`Kamino market account is missing: ${market.toBase58()}`);
  }

  const accounts = await connection.getMultipleAccountsInfo(
    candidates,
    "confirmed"
  );
  const decoded = accounts.flatMap((account, index) => {
    if (!account || !account.owner.equals(marketAccount.owner)) {
      return [];
    }
    const reserve = decodeReserve(
      account.data,
      market,
      candidates[index],
      marketAccount.owner
    );
    return reserve ? [reserve] : [];
  });

  const mintAccounts = await connection.getMultipleAccountsInfo(
    decoded.map((reserve) => reserve.liquidityMint),
    "confirmed"
  );
  return decoded.filter(
    (reserve, index) =>
      reserve.supplyEnabled &&
      mintAccounts[index] !== null &&
      mintAccounts[index]!.owner.equals(
        readPublicKey(
          accounts[
            candidates.findIndex((candidate) =>
              candidate.equals(reserve.reserve)
            )
          ]!.data,
          reserveLiquidityOffset + 280
        )
      )
  );
}

export function assertReserveMatchesComponent(
  reserve: ReserveDescriptor,
  expected: ReserveComponentIdentity
): void {
  if (!reserve.market.equals(expected.market)) {
    throw new Error("reserve market does not match component");
  }
  if (!reserve.liquidityMint.equals(expected.liquidityMint)) {
    throw new Error("reserve liquidity mint does not match component");
  }
  if (!reserve.collateralMint.equals(expected.collateralMint)) {
    throw new Error("reserve collateral mint does not match component");
  }
  if (!reserve.oracle.equals(expected.oracle)) {
    throw new Error("reserve oracle does not match component");
  }
  if (!reserve.tokenProgram.equals(expected.tokenProgram)) {
    throw new Error("reserve token program does not match component");
  }
  if (!reserve.supplyEnabled) {
    throw new Error("reserve does not allow supply");
  }
}

export const decodeReserveAccount = (
  data: Buffer,
  market: PublicKey,
  reserve: PublicKey,
  programOwner: PublicKey
): ReserveDescriptor | null => decodeReserve(data, market, reserve, programOwner);
