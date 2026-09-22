"use client";

import { Suspense } from "react";
import { AppPage } from "@/views/AppPage";

export default function Page() {
  return (
    <Suspense fallback={<p className="hint">Loading desk…</p>}>
      <AppPage />
    </Suspense>
  );
}
