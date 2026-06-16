/* eslint-disable react-refresh/only-export-components */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { api, configureApi, login as apiLogin } from "./api/client";
import type {
  Branding,
  ServerHandshake,
  SessionResponse,
  Theme,
  User,
} from "./api/generated";
import { isPortal, portal, type ServerProfile } from "./portal";

interface RuntimeContextValue {
  handshake: ServerHandshake;
  profile: ServerProfile | null;
  secureStorageAvailable: boolean;
}

const RuntimeContext = createContext<RuntimeContextValue | null>(null);

export function RuntimeProvider({
  handshake,
  profile,
  secureStorageAvailable,
  children,
}: RuntimeContextValue & { children: ReactNode }) {
  const resolvedHandshake = useMemo<ServerHandshake>(() => {
    const resolve = (value: string | null) =>
      value
        ? new URL(value, profile?.url ?? window.location.origin).toString()
        : null;
    return {
      ...handshake,
      branding: {
        ...handshake.branding,
        logo_url: resolve(handshake.branding.logo_url),
        favicon_url: resolve(handshake.branding.favicon_url),
        custom_css_url: resolve(handshake.branding.custom_css_url),
      },
    };
  }, [handshake, profile?.url]);
  useBranding(resolvedHandshake.branding);
  return (
    <RuntimeContext.Provider
      value={{ handshake: resolvedHandshake, profile, secureStorageAvailable }}
    >
      {children}
    </RuntimeContext.Provider>
  );
}

export function useRuntime() {
  const value = useContext(RuntimeContext);
  if (!value) throw new Error("Runtime context is unavailable.");
  return value;
}

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  login: (login: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  updateTheme: (theme: Theme) => Promise<void>;
  storageWarning: string | null;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const runtime = useRuntime();
  const queryClient = useQueryClient();
  const [storageWarning, setStorageWarning] = useState<string | null>(null);
  const sessionKey = useMemo(
    () => ["session", runtime.profile?.id ?? "browser"] as const,
    [runtime.profile?.id],
  );
  const session = useQuery({
    queryKey: sessionKey,
    queryFn: async () => {
      const response = await api<SessionResponse>("/auth/session");
      configureApi({ csrfToken: response.csrf_token });
      return response.user;
    },
    retry: false,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });

  const login = useCallback(
    async (loginName: string, password: string) => {
      const response = await apiLogin(loginName, password, isPortal);
      if (isPortal && runtime.profile && response.bearer_token) {
        try {
          await portal.storeCredential(
            runtime.profile.serverUuid,
            response.bearer_token,
          );
          setStorageWarning(null);
        } catch {
          setStorageWarning(
            "Secure credential storage is unavailable. This session will last only until Portal closes.",
          );
        }
      }
      queryClient.setQueryData(sessionKey, response.user);
    },
    [queryClient, runtime.profile, sessionKey],
  );

  const logout = useCallback(async () => {
    await api<void>("/auth/logout", { method: "POST" }).catch(() => undefined);
    if (runtime.profile)
      await portal
        .deleteCredential(runtime.profile.serverUuid)
        .catch(() => undefined);
    configureApi({ bearerToken: null, csrfToken: null });
    queryClient.setQueryData(sessionKey, null);
    applyTheme("system");
  }, [queryClient, runtime.profile, sessionKey]);

  const refresh = useCallback(async () => {
    await session.refetch();
  }, [session]);

  const updateTheme = useCallback(
    async (theme: Theme) => {
      const user = await api<User>("/auth/preferences", {
        method: "PUT",
        body: JSON.stringify({ theme }),
      });
      queryClient.setQueryData(sessionKey, user);
      applyTheme(user.theme);
    },
    [queryClient, sessionKey],
  );

  useEffect(() => {
    if (session.data) applyTheme(session.data.theme);
  }, [session.data]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user: session.data ?? null,
      loading: session.isLoading,
      login,
      logout,
      refresh,
      updateTheme,
      storageWarning,
    }),
    [
      login,
      logout,
      refresh,
      session.data,
      session.isLoading,
      storageWarning,
      updateTheme,
    ],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("Auth context is unavailable.");
  return value;
}

function useBranding(branding: Branding) {
  useEffect(() => {
    document.title = branding.server_name;
    document.documentElement.style.setProperty(
      "--accent",
      branding.accent_color,
    );
    applyTheme("system");
    let icon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (branding.favicon_url) {
      if (!icon) {
        icon = document.createElement("link");
        icon.rel = "icon";
        document.head.append(icon);
      }
      icon.href = branding.favicon_url;
    }
    let custom = document.querySelector<HTMLLinkElement>("#server-custom-css");
    if (branding.custom_css_url) {
      if (!custom) {
        custom = document.createElement("link");
        custom.id = "server-custom-css";
        custom.rel = "stylesheet";
        document.head.append(custom);
      }
      custom.href = branding.custom_css_url;
    } else {
      custom?.remove();
    }
  }, [branding]);
}

export function applyTheme(theme: Theme) {
  const dark =
    theme === "dark" ||
    (theme === "system" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
}
