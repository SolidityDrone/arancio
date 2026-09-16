import { Connection, PublicKey } from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";

export async function fetchTokenBalance(
  connection: Connection,
  mint: PublicKey,
  owner: PublicKey,
  tokenProgram: PublicKey = TOKEN_PROGRAM_ID
): Promise<{ ui: string; raw: bigint; decimals: number }> {
  const ata = getAssociatedTokenAddressSync(mint, owner, false, tokenProgram);
  try {
    const balance = await connection.getTokenAccountBalance(ata);
    return {
      ui: balance.value.uiAmountString ?? "0",
      raw: BigInt(balance.value.amount),
      decimals: balance.value.decimals,
    };
  } catch {
    return { ui: "0", raw: 0n, decimals: 0 };
  }
}

export async function fetchUnderlyingBalance(
  connection: Connection,
  mint: PublicKey,
  owner: PublicKey
): Promise<{ ui: string; raw: bigint; decimals: number }> {
  let decimals = 8;
  try {
    const mintInfo = await connection.getParsedAccountInfo(mint);
    decimals =
      (
        mintInfo.value?.data as
          | { parsed?: { info?: { decimals?: number } } }
          | undefined
      )?.parsed?.info?.decimals ?? 8;
  } catch {
    /* default */
  }
  const bal = await fetchTokenBalance(
    connection,
    mint,
    owner,
    TOKEN_2022_PROGRAM_ID
  );
  return { ...bal, decimals: bal.decimals || decimals };
}
