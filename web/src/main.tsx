import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Buffer } from "buffer";
import { WalletProviders } from "./components/WalletProviders";
import { LandingPage } from "./pages/LandingPage";
import { AppPage } from "./pages/AppPage";
import "./styles/global.css";

(window as any).Buffer = Buffer;
const proc = ((window as any).process ??= { env: {} as Record<string, string> });
if (!proc.version) proc.version = "v18.0.0";
if (proc.browser === undefined) proc.browser = true;

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <WalletProviders>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/app" element={<AppPage />} />
        </Routes>
      </BrowserRouter>
    </WalletProviders>
  </React.StrictMode>
);
