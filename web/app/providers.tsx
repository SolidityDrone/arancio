"use client";

import { Buffer } from "buffer";
import { FxLayer } from "@/components/FxLayer";
import { WalletProviders } from "@/components/WalletProviders";

if (typeof window !== "undefined") {
  (window as unknown as { Buffer: typeof Buffer }).Buffer = Buffer;
  const proc = ((window as unknown as { process?: { env: Record<string, string>; version?: string; browser?: boolean } }).process ??= { env: {} });
  if (!proc.version) proc.version = "v18.0.0";
  if (proc.browser === undefined) proc.browser = true;
}

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <WalletProviders>
      <FxLayer />
      {children}
    </WalletProviders>
  );
}
