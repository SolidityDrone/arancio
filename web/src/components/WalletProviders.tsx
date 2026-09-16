// @ts-nocheck — wallet-adapter FC types clash with React 18/19 @types
import { useMemo } from "react";
import {
  ConnectionProvider,
  WalletProvider,
} from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import {
  PhantomWalletAdapter,
  SolflareWalletAdapter,
} from "@solana/wallet-adapter-wallets";
import { DEFAULT_RPC } from "../lib/markets";
import "@solana/wallet-adapter-react-ui/styles.css";

const APP_ICON =
  typeof window !== "undefined"
    ? `${window.location.origin}/logos/KOx.png`
    : undefined;

export function WalletProviders({ children }: { children: React.ReactNode }) {
  const endpoint = DEFAULT_RPC;
  const wallets = useMemo(
    () => [
      new PhantomWalletAdapter({
        appIdentity: {
          name: "Orange DivStrip",
          uri:
            typeof window !== "undefined"
              ? window.location.origin
              : "http://127.0.0.1:5173",
          icon: APP_ICON,
        },
      }),
      new SolflareWalletAdapter(),
    ],
    []
  );

  return (
    <ConnectionProvider
      endpoint={endpoint}
      config={{ commitment: "confirmed", confirmTransactionInitialTimeout: 60_000 }}
    >
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
