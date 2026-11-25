// Components for the dark amber theme used on inner pages:
// count badges, a wallet-style balance card, icon list rows, a roadmap timeline and a countdown.
import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Icon, type IconName } from "./icons";

/** Round count badge: "5", "99+". `soft` is the pale variant. */
export function CountBadge({ n, soft, square }: { n: number; soft?: boolean; square?: boolean }) {
  if (n <= 0) return null;
  return <span className={`count-badge ${soft ? "soft" : ""} ${square ? "square" : ""}`}>{n > 99 ? "99+" : n}</span>;
}

/** Wallet-style balance card: big figure, unit, caption and a row of quick actions. */
export function WalletCard({ label, value, unit, caption, actions }: { label: string; value: ReactNode; unit?: string; caption?: ReactNode; actions?: { icon: IconName; label: string; to?: string; onClick?: () => void }[] }) {
  return (
    <section className="wallet">
      <span className="wallet-label">{label}</span>
      <div className="wallet-value">
        {value}
        {unit && <span className="wallet-unit">{unit}</span>}
      </div>
      {caption && <div className="wallet-caption">{caption}</div>}
      {actions && (
        <div className="wallet-actions">
          {actions.map((a) =>
            a.to ? (
              <Link key={a.label} to={a.to} className="wallet-action"><span className="wallet-action-icon"><Icon name={a.icon} size={18} /></span>{a.label}</Link>
            ) : (
              <button key={a.label} type="button" className="wallet-action" onClick={a.onClick}><span className="wallet-action-icon"><Icon name={a.icon} size={18} /></span>{a.label}</button>
            ),
          )}
        </div>
      )}
    </section>
  );
}

/** List row with a round icon, a title and caption, and a value aligned right (like a token list). */
export function TokenRow({ icon, title, caption, value, sub, to, accent }: { icon: IconName | ReactNode; title: ReactNode; caption?: ReactNode; value?: ReactNode; sub?: ReactNode; to?: string; accent?: boolean }) {
  const body = (
    <>
      <span className={`token-icon ${accent ? "accent" : ""}`}>{typeof icon === "string" ? <Icon name={icon as IconName} size={18} /> : icon}</span>
      <span className="token-main">
        <span className="token-title">{title}</span>
        {caption && <span className="token-caption">{caption}</span>}
      </span>
      {(value || sub) && (
        <span className="token-value">
          {value}
          {sub && <span className="token-sub">{sub}</span>}
        </span>
      )}
    </>
  );
  return to ? <Link to={to} className="token-row">{body}</Link> : <div className="token-row">{body}</div>;
}

export interface TimelineItem {
  key: string;
  when: ReactNode;
  title: ReactNode;
  body?: ReactNode;
  state?: "done" | "current" | "todo";
  action?: ReactNode;
}

/** Roadmap timeline: centre line with nodes; cards alternate sides on wide screens. */
export function Timeline({ items }: { items: TimelineItem[] }) {
  return (
    <ol className="timeline">
      {items.map((it, i) => (
        <li key={it.key} className={`tl-item ${i % 2 ? "right" : "left"} ${it.state ?? "todo"}`}>
          <span className="tl-node" aria-hidden>{it.state === "done" ? <Icon name="check" size={14} /> : it.state === "todo" ? <Icon name="lock" size={12} /> : null}</span>
          <div className="tl-card">
            <span className="tl-when">{it.when}</span>
            <div className="tl-title">{it.title}</div>
            {it.body && <div className="tl-body">{it.body}</div>}
            {it.action && <div className="tl-action">{it.action}</div>}
          </div>
        </li>
      ))}
    </ol>
  );
}

/** Countdown boxes (days / hours / minutes / seconds) to a deadline. */
export function Countdown({ to, label }: { to: string; label: string }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const diff = Date.parse(to) - now;
  const late = diff < 0;
  const s = Math.floor(Math.abs(diff) / 1000);
  const parts = [
    { v: Math.floor(s / 86400), u: "Days" },
    { v: Math.floor((s % 86400) / 3600), u: "Hours" },
    { v: Math.floor((s % 3600) / 60), u: "Minutes" },
    { v: s % 60, u: "Seconds" },
  ];
  return (
    <section className={`countdown ${late ? "late" : ""}`} aria-label={`${label}: ${late ? "overdue by" : ""} ${parts[0]!.v} days ${parts[1]!.v} hours`}>
      <span className="countdown-label">{late ? "Overdue by" : label}</span>
      <div className="countdown-boxes">
        {parts.map((p) => (
          <div key={p.u} className="countdown-box">
            <strong>{String(p.v).padStart(2, "0")}</strong>
            <span>{p.u}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
