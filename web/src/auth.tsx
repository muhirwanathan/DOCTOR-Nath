import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api, getToken, setToken } from "./api";

export type Role = "LEARNER" | "MENTOR" | "ADMIN";
export interface User {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  role: Role;
  language: "en" | "rw";
  skills: string[];
  expertise: string[];
  portfolioPublic: boolean;
  portfolioSlug: string | null;
}

interface AuthCtx {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<User>;
  register: (data: Record<string, unknown>) => Promise<User>;
  logout: () => void;
  refresh: () => Promise<void>;
}

const Ctx = createContext<AuthCtx>(null as unknown as AuthCtx);
const USER_KEY = "drnath.user";

export function AuthProvider({ children }: { children: ReactNode }) {
  // The cached profile lets the app open offline on a phone that logged in before.
  const [user, setUser] = useState<User | null>(() => {
    const cached = localStorage.getItem(USER_KEY);
    return cached && getToken() ? (JSON.parse(cached) as User) : null;
  });
  const [loading, setLoading] = useState(!!getToken());

  const store = (u: User | null) => {
    setUser(u);
    if (u) localStorage.setItem(USER_KEY, JSON.stringify(u));
    else localStorage.removeItem(USER_KEY);
  };

  const refresh = useCallback(async () => {
    if (!getToken()) return setLoading(false);
    try {
      store(await api<User>("GET", "/api/me"));
    } catch {
      // Offline: keep the cached profile. A 401 has already cleared the token.
      if (!getToken()) store(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const onLogout = () => store(null);
    window.addEventListener("drnath:logout", onLogout);
    return () => window.removeEventListener("drnath:logout", onLogout);
  }, [refresh]);

  const login = async (email: string, password: string) => {
    const r = await api<{ token: string; user: User }>("POST", "/api/auth/login", { email, password });
    setToken(r.token);
    store(r.user);
    return r.user;
  };
  const register = async (data: Record<string, unknown>) => {
    const r = await api<{ token: string; user: User }>("POST", "/api/auth/register", data);
    setToken(r.token);
    store(r.user);
    return r.user;
  };
  const logout = () => {
    setToken(null);
    store(null);
  };

  return <Ctx.Provider value={{ user, loading, login, register, logout, refresh }}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);
