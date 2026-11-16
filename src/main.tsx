/**
 * Browser-Einstiegspunkt mit StrictMode, Fehlergrenze, Router, QueryClient und AuthProvider. Private Serverdaten bleiben im Arbeitsspeicher; Mutationen werden nicht automatisch wiederholt oder offline als erfolgreich vorgemerkt.
 */
import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "./lib/i18n";
import "./styles.css";
import { App, ErrorBoundary } from "./app/app";
import { AuthProvider } from "./features/auth/auth-context";
// Memory-only cache. No persister or service-worker caching for API/private data.
/** Ein gemeinsamer speicherbasierter QueryClient; Schreiboperationen werden weder automatisch wiederholt noch offline bestätigt. */
const client = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 15000, retry: 1, refetchOnWindowFocus: true },
    mutations: { retry: 0, networkMode: "always" },
  },
});
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={client}>
        <BrowserRouter>
          <AuthProvider>
            <App />
          </AuthProvider>
        </BrowserRouter>
      </QueryClientProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);
