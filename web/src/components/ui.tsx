import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import QRCode from "qrcode";
import { api, NetworkError } from "../api";
import { Icon, type IconName } from "./icons";

/** Loads JSON from the API, with loading/error state and a reload function. */
export function useLoad<T>(url: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!!url);
  const reload = useCallback(async () => {
    if (!url) return;
    setLoading(true);
    try {
      setData(await api<T>("GET", url));
      setError(null);
    } catch (err) {
      setError(err instanceof NetworkError ? "You are offline. Connect to load this page." : (err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [url]);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { data, error, loading, reload, setData };
}

/** Small uppercase label in a pill, with an accent dot. */
export const Eyebrow = ({ children }: { children: ReactNode }) => <span className="eyebrow">{children}</span>;

/** Display heading: plain words, then the accent words in gold. */
export function Title({ text, accent, after, as: Tag = "h1" }: { text: string; accent?: string; after?: string; as?: "h1" | "h2" }) {
  return (
    <Tag className={Tag === "h1" ? "display" : "display-2"}>
      {text} {accent && <span className="accent">{accent}</span>} {after}
    </Tag>
  );
}

export function Page({ title, accent, eyebrow, lead, children, actions }: { title: string; accent?: string; eyebrow?: string; lead?: ReactNode; children: ReactNode; actions?: ReactNode }) {
  return (
    <main className="page">
      <header className="page-head">
        <div>
          {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
          <Title text={title} accent={accent} />
          {lead && <p className="lead">{lead}</p>}
        </div>
        {actions && <div className="page-actions">{actions}</div>}
      </header>
      {children}
    </main>
  );
}

/** Dark band with a watermark word, used at the top of key pages. */
export function Hero({ eyebrow, title, accent, after, lead, aside, children, watermark = "nath" }: {
  eyebrow?: string; title: string; accent?: string; after?: string; lead?: ReactNode; aside?: ReactNode; children?: ReactNode; watermark?: string;
}) {
  return (
    <section className="hero">
      <span className="watermark" aria-hidden>{watermark}</span>
      <div className="hero-inner">
        <div className="hero-copy">
          {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
          <Title text={title} accent={accent} after={after} />
          {lead && <p className="lead">{lead}</p>}
          {children}
        </div>
        {aside && <div className="hero-aside">{aside}</div>}
      </div>
    </section>
  );
}

export function Section({ eyebrow, title, accent, children, actions }: { eyebrow?: string; title: string; accent?: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="section">
      <div className="section-head">
        <div>
          {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
          <Title as="h2" text={title} accent={accent} />
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

/** Numbered list row with a round accent arrow, e.g. "01  Residential design  ->". */
export function NumberedRow({ n, to, title, meta, tag, dim, onClick }: { n: number; to?: string; title: ReactNode; meta?: ReactNode; tag?: ReactNode; dim?: boolean; onClick?: () => void }) {
  const body = (
    <>
      <span className="num">{String(n).padStart(2, "0")}</span>
      <span className="row-body">
        <span className="row-title">{title}</span>
        {meta && <span className="row-meta">{meta}</span>}
      </span>
      {tag}
      <span className="arrow-dot" aria-hidden><Icon name={dim ? "lock" : "arrowRight"} size={18} /></span>
    </>
  );
  const cls = `nrow ${dim ? "dim" : ""}`;
  if (to) return <Link to={to} className={cls}>{body}</Link>;
  if (onClick) return <button type="button" className={cls} onClick={onClick}>{body}</button>;
  return <div className={cls}>{body}</div>;
}

/** Outlined pill with a round accent arrow, e.g. "Take Counsel (->)". */
export function ArrowButton({ children, to, onClick, disabled, type = "button", icon = "arrowUpRight" }: { children: ReactNode; to?: string; onClick?: () => void; disabled?: boolean; type?: "button" | "submit"; icon?: IconName }) {
  const inner = (<>{children}<span className="arrow-dot" aria-hidden><Icon name={icon} size={16} /></span></>);
  return to ? <Link to={to} className="btn-arrow">{inner}</Link> : <button type={type} className="btn-arrow" onClick={onClick} disabled={disabled}>{inner}</button>;
}

export const Card = ({ children, className = "" }: { children: ReactNode; className?: string }) => <section className={`card ${className}`}>{children}</section>;

export function Loading() {
  return <p className="muted" role="status">Loading...</p>;
}

export function ErrorBox({ message }: { message: string | null }) {
  return message ? <p className="error" role="alert">{message}</p> : null;
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>;
}

export function Progress({ pct, label }: { pct: number; label?: string }) {
  return (
    <div className="progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={label ?? "Progress"}>
      <div style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Stars({ value, outOf = 5 }: { value: number; outOf?: number }) {
  return (
    <span className="stars" aria-label={`${value.toFixed(1)} out of ${outOf}`}>
      {Array.from({ length: outOf }, (_, i) => <span key={i} className={i < Math.round(value) ? "on" : ""} />)}
    </span>
  );
}

export function QrCode({ text, size = 120 }: { text: string; size?: number }) {
  const [src, setSrc] = useState("");
  useEffect(() => {
    QRCode.toDataURL(text, { width: size, margin: 1, color: { dark: "#17171a", light: "#ffffff" } }).then(setSrc).catch(() => setSrc(""));
  }, [text, size]);
  return src ? <img src={src} width={size} height={size} alt={`QR code linking to ${text}`} /> : null;
}

export const themeLabel = (theme: string) => theme[0] + theme.slice(1).toLowerCase();
export const themeClass = (theme: string) => `theme-${theme.toLowerCase()}`;
export const fmtDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
export const pct = (x: number) => `${Math.round(x * 100)}%`;
