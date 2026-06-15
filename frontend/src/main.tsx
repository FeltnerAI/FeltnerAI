import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import { AuthProvider, RuntimeProvider } from "./contexts";
import { PortalGate } from "./PortalGate";
import "./styles.css";

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 10_000, retry: 1 } },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <PortalGate>
        {(runtime) => (
          <RuntimeProvider {...runtime}>
            <AuthProvider>
              <BrowserRouter>
                <App changeServer={runtime.changeServer} />
              </BrowserRouter>
            </AuthProvider>
          </RuntimeProvider>
        )}
      </PortalGate>
    </QueryClientProvider>
  </StrictMode>,
);
