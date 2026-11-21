/**
 * Browser entry with StrictMode, error boundary, router, QueryClient and AuthProvider. Keep
 * private server data in memory; never automatically retry mutations or claim offline success.
 */
import React from "react";
import ReactDOM from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "./lib/i18n";
import "./styles.css";
import { installationBrand } from "./lib/installation-brand";
import { App, ErrorBoundary } from "./app/app";
import { AuthProvider } from "./features/auth/auth-context";
if (installationBrand.edition !== "internal") {
  document.title = installationBrand.name;
  document.documentElement.style.setProperty(
    "--portal-mobile-brand",
    JSON.stringify(installationBrand.shortName),
  );
}
// Memory-only cache. No persister or service-worker caching for API/private data.
/** One memory-only QueryClient; mutations neither retry automatically nor become offline confirmations. */
const client = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 15000, retry: 1, refetchOnWindowFocus: true },
    mutations: { retry: 0, networkMode: "always" },
  },
});
const router = createBrowserRouter([
  {
    path: "*",
    element: (
      <AuthProvider>
        <App />
      </AuthProvider>
    ),
  },
]);
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);
