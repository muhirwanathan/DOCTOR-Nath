import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { CountBadge } from "./dege";
import { api } from "../api";
import { useAuth } from "../auth";
import { useI18n, type Key } from "../i18n";
import { flush, onOutboxChange, queued, type QueuedRequest } from "../offline/outbox";
import { Icon, Logo, type IconName } from "./icons";

const NAV: Record<string, { to: string; key: Key; icon: IconName }[]> = {
  LEARNER: [
    { to: "/", key: "home", icon: "home" },
    { to: "/challenges", key: "challenges", icon: "grid" },
    { to: "/portfolio", key: "portfolio", icon: "award" },
    { to: "/profile", key: "profile", icon: "user" },
  ],
  MENTOR: [
    { to: "/", key: "queue", icon: "list" },
    { to: "/challenges", key: "challenges", icon: "grid" },
    { to: "/profile", key: "profile", icon: "user" },
  ],
  ADMIN: [
    { to: "/", key: "dashboard", icon: "chart" },
    { to: "/admin/challenges", key: "challenges", icon: "grid" },
    { to: "/admin/users", key: "users", icon: "users" },
    { to: "/admin/audit", key: "audit", icon: "chain" },
  ],
};

function useOnline() {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);
  return online;
}

export function Brand() {
  return (
    <Link to="/" className="brand" aria-label="Dr. Nath home">
      <Logo />
      <span>dr.nath</span>
    </Link>
  );
}

export default function Layout() {
  const { user, logout } = useAuth();
  const { t, lang, setLang } = useI18n();
  const online = useOnline();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [outbox, setOutbox] = useState<QueuedRequest[]>([]);
  const [unread, setUnread] = useState(0);
  const [queueSize, setQueueSize] = useState(0);
  // Role home pages keep the light editorial theme; every other page uses the dark amber theme.
  const dark = pathname !== "/";

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  useEffect(() => {
    const refresh = () => void queued().then(setOutbox);
    refresh();
    return onOutboxChange(refresh);
  }, []);

  useEffect(() => {
    if (!online) return;
    const load = () => {
      api<{ read: boolean }[]>("GET", "/api/notifications").then((n) => setUnread(n.filter((x) => !x.read).length)).catch(() => {});
      if (user?.role === "MENTOR") api<unknown[]>("GET", "/api/mentor/queue").then((q) => setQueueSize(q.length)).catch(() => {});
    };
    load();
    const timer = setInterval(load, 60_000);
    return () => clearInterval(timer);
  }, [online, user?.role]);

  if (!user) return null;
  const pending = outbox.filter((o) => !o.error).length;
  const failed = outbox.filter((o) => o.error).length;
  const links = NAV[user.role]!;

  return (
    <div className={`shell role-${user.role.toLowerCase()} ${dark ? "dege" : ""}`}>
      <header className="topbar">
        <Brand />
        <nav className="topnav" aria-label="Main">
          {links.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.to === "/"}>
              {t(n.key)}
              {n.key === "queue" && <CountBadge n={queueSize} soft />}
            </NavLink>
          ))}
        </nav>
        <div className="topbar-right">
          {!online && <span className="status-pill warn"><Icon name="cloudOff" size={14} />{t("offline")}</span>}
          {pending > 0 && (
            <button className="status-pill" onClick={() => void flush()} title="Send queued work now">
              <Icon name="upload" size={14} />{pending} {t("pending")}
            </button>
          )}
          {failed > 0 && <Link to="/profile" className="status-pill bad">{failed} failed</Link>}
          <button className="round-btn" aria-label={`${t("notifications")} (${unread} unread)`} onClick={() => navigate("/notifications")}>
            <Icon name="bell" />
            {unread > 0 && <span className="count"><CountBadge n={unread} /></span>}
          </button>
          <button className="round-btn lang" onClick={() => setLang(lang === "en" ? "rw" : "en")} aria-label="Switch language" title="Switch language">
            {lang === "en" ? "RW" : "EN"}
          </button>
          <button className="round-btn" onClick={logout} aria-label={t("logout")} title={t("logout")}>
            <Icon name="logout" />
          </button>
        </div>
      </header>
      <Outlet />
      <nav className="bottomnav" aria-label="Main">
        {links.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.to === "/"}>
            <span className="nav-icon">
              <Icon name={n.icon} size={22} />
              {n.key === "queue" && <CountBadge n={queueSize} />}
            </span>
            {t(n.key)}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
