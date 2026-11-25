import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api";
import { useI18n } from "../i18n";
import { Card, Empty, ErrorBox, fmtDate, Loading, Page, Progress, QrCode, themeLabel, useLoad } from "../components/ui";
import { type IconName } from "../components/icons";
import { CountBadge, TokenRow, WalletCard } from "../components/dege";
import { Brand } from "../components/Layout";

interface PortfolioData {
  name: string;
  public?: boolean;
  publicUrl: string;
  projects: { title: string; theme: string; completedAt: string; mentorRating: number | null; calibratedRating: number | null }[];
  badges: { id: string; name: string; issuedAt: string; verifyUrl: string }[];
  skills: { skill: string; level: number }[];
}

const THEME_ICON: Record<string, IconName> = { AGRICULTURE: "grid", HEALTH: "user", EDUCATION: "list", ICT: "chart" };

function PortfolioBody({ data, showQr, actions }: { data: PortfolioData; showQr: boolean; actions?: Parameters<typeof WalletCard>[0]["actions"] }) {
  const { t } = useI18n();
  const avg = data.projects.filter((p) => p.calibratedRating !== null);
  const mean = avg.length ? avg.reduce((s, p) => s + p.calibratedRating!, 0) / avg.length : null;
  return (
    <>
      <WalletCard
        label={`${data.name} · verified badges`}
        value={data.badges.length}
        unit={data.badges.length === 1 ? "badge" : "badges"}
        caption={`${data.projects.length} completed projects${mean !== null ? ` · average calibrated rating ${mean.toFixed(1)}/5` : ""}`}
        actions={actions}
      />

      <h2>{t("badges")} <CountBadge n={data.badges.length} soft /></h2>
      {data.badges.length === 0 && <Empty>Badges appear here when a mentor approves your final stage.</Empty>}
      {data.badges.length > 0 && (
        <div className="token-list">
          {data.badges.map((b) => (
            <TokenRow
              key={b.id}
              icon="award"
              accent
              title={b.name}
              caption={<>Issued {fmtDate(b.issuedAt)} · <Link to={`/verify/${b.id}`}>verify</Link></>}
              value={showQr ? <QrCode text={b.verifyUrl} size={64} /> : <Link to={`/verify/${b.id}`} className="btn">Verify</Link>}
              sub={showQr ? undefined : "Signed"}
            />
          ))}
        </div>
      )}

      <h2>{t("completed")} <CountBadge n={data.projects.length} soft /></h2>
      {data.projects.length === 0 && <Empty>No completed projects yet.</Empty>}
      {data.projects.length > 0 && (
        <div className="token-list">
          {data.projects.map((p) => (
            <TokenRow
              key={p.title}
              icon={THEME_ICON[p.theme] ?? "grid"}
              title={p.title}
              caption={`${themeLabel(p.theme)} · completed ${fmtDate(p.completedAt)}`}
              value={p.calibratedRating !== null ? `${p.calibratedRating.toFixed(1)} / 5` : "-"}
              sub={p.mentorRating !== null ? `mentor ${p.mentorRating.toFixed(1)}, calibrated` : undefined}
            />
          ))}
        </div>
      )}

      {data.skills.length > 0 && (
        <>
          <h2>Demonstrated skills</h2>
          <Card>
            {data.skills.map((s) => (
              <div key={s.skill} className="skill">
                <span>{s.skill}</span>
                <Progress pct={Math.round(s.level * 100)} label={`${s.skill} level`} />
              </div>
            ))}
            <p className="small muted">Built from mentor-approved work, adjusted for how strict each mentor is.</p>
          </Card>
        </>
      )}
    </>
  );
}

export function Portfolio() {
  const { t } = useI18n();
  const { data, error, loading, reload } = useLoad<PortfolioData>("/api/portfolio");
  const [copied, setCopied] = useState(false);

  const toggle = async () => {
    await api("PATCH", "/api/me", { portfolioPublic: !data?.public });
    await reload();
  };
  const share = async () => {
    if (!data) return;
    if (!data.public) await toggle();
    if (navigator.share) await navigator.share({ title: `${data.name} on Dr. Nath`, url: data.publicUrl }).catch(() => {});
    else {
      await navigator.clipboard.writeText(data.publicUrl);
      setCopied(true);
    }
  };

  return (
    <Page eyebrow="Your proof of skill" title="My" accent="portfolio">
      {loading && <Loading />}
      <ErrorBox message={error} />
      {data && (
        <>
          <PortfolioBody
            data={data}
            showQr
            actions={[
              { icon: "upload", label: t("share"), onClick: () => void share() },
              { icon: data.public ? "lock" : "globe", label: data.public ? "Make private" : "Make public", onClick: () => void toggle() },
              { icon: "grid", label: "Challenges", to: "/challenges" },
            ]}
          />
          <p className="small muted">{data.public ? "Your portfolio is public. Anyone with the link can see it." : "Your portfolio is private. Only you can see it until you share it."}</p>
          {copied && <p className="notice small">Link copied: {data.publicUrl}</p>}
        </>
      )}
    </Page>
  );
}

export function PublicPortfolio() {
  const { slug } = useParams();
  const { data, error, loading } = useLoad<PortfolioData>(`/api/public/portfolio/${slug}`);
  return (
    <div className="public dege shell">
      <header className="topbar"><Brand /></header>
      <Page eyebrow="Verified on Dr. Nath" title={data?.name ?? "Portfolio"} accent="portfolio">
        {loading && <Loading />}
        <ErrorBox message={error} />
        {data && <PortfolioBody data={data} showQr={false} />}
      </Page>
    </div>
  );
}

interface VerifyData {
  valid: boolean;
  reason?: string;
  revoked: boolean;
  jwt: string;
  header?: { kid: string };
  credential?: { name: string; validFrom: string; issuer: { id: string; name: string }; credentialSubject: { name: string; achievement: { name: string; criteria: { narrative: string } } } };
  issuer: { did: string; didDocument: string };
}

export function Verify() {
  const { id } = useParams();
  const { data, error, loading } = useLoad<VerifyData>(`/api/public/credentials/${id}`);
  const ok = data?.valid && !data.revoked;
  return (
    <div className="public dege shell">
      <header className="topbar"><Brand /></header>
      <Page eyebrow="Credential check" title="Badge" accent="verification">
        {loading && <Loading />}
        <ErrorBox message={error} />
        {data && (
          <Card className={ok ? "verified" : "unverified"}>
            <h2>{ok ? "Authentic badge" : "This badge could not be verified"}</h2>
            {data.credential && (
              <>
                <p><strong>{data.credential.credentialSubject.achievement.name}</strong> awarded to <strong>{data.credential.credentialSubject.name}</strong></p>
                <p className="small">Issued {fmtDate(data.credential.validFrom)} by {data.credential.issuer.name}</p>
                <p className="small muted">{data.credential.credentialSubject.achievement.criteria.narrative}</p>
              </>
            )}
            {data.revoked && <p className="error">This badge has been revoked by the issuer.</p>}
            {!data.valid && <p className="error">{data.reason}</p>}
            <details>
              <summary>How this was checked</summary>
              <ol className="small">
                <li>The badge is a W3C Verifiable Credential (Open Badges 3.0), signed with the issuer's Ed25519 key.</li>
                <li>The signature was checked against the public key published at <a href={data.issuer.didDocument}>{data.issuer.did}</a>.</li>
                <li>Any change to the badge's content, even one letter, makes the signature fail.</li>
              </ol>
              <p className="small">Raw credential (verify it yourself with any VC tool):</p>
              <textarea readOnly rows={4} value={data.jwt} aria-label="Signed credential" />
            </details>
          </Card>
        )}
      </Page>
    </div>
  );
}
