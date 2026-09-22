"use client";

import { useEffect, useState } from "react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";

/** Defer wallet UI until mount — avoids SSR/client mismatch from autoConnect + wallet icons. */
export function ClientWalletButton() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <button
        type="button"
        className="wallet-adapter-button wallet-adapter-button-trigger"
        disabled
        aria-hidden
      >
        Select Wallet
      </button>
    );
  }

  return <WalletMultiButton />;
}
