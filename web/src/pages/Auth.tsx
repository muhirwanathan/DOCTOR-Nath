import { useState, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, ApiError } from "../api";
import { useAuth } from "../auth";
import { useI18n } from "../i18n";
import { Brand } from "../components/Layout";
import { Icon } from "../components/icons";
import { Eyebrow, Title } from "../components/ui";

function AuthShell({ children }: { children: ReactNode }) {
  return (
    <main className="auth">
      <section className="auth-hero">
        <Brand />
        <div>
          <Eyebrow>Kigali pilot · ages 20-38</Eyebrow>
          <Title text="Solve real problems." accent="Prove real skills." />
          <p className="lead">Staged challenges from Rwandan communities and employers, feedback from volunteer mentors, and badges any employer can verify.</p>
          <ul className="ticks">
            <li><Icon name="check" size={18} />Mentor feedback within 5 days</li>
            <li><Icon name="check" size={18} />Works offline on 3G</li>
            <li><Icon name="check" size={18} />Verifiable portfolio</li>
            <li><Icon name="check" size={18} />English and Kinyarwanda</li>
          </ul>
        </div>
      </section>
      <div className="auth-side">{children}</div>
    </main>
  );
}

function fieldErrors(err: unknown): Record<string, string> {
  if (err instanceof ApiError && err.details?.fields) {
    return Object.fromEntries((err.details.fields as { field: string; message: string }[]).map((f) => [f.field, f.message]));
  }
  return {};
}

function LangSwitch() {
  const { lang, setLang, t } = useI18n();
  return (
    <p className="muted small">
      {t("language")}:{" "}
      <button type="button" className={`link-btn ${lang === "en" ? "active" : ""}`} onClick={() => setLang("en")}>English</button> |{" "}
      <button type="button" className={`link-btn ${lang === "rw" ? "active" : ""}`} onClick={() => setLang("rw")}>Kinyarwanda</button>
    </p>
  );
}

export function Login() {
  const { login } = useAuth();
  const { t } = useI18n();
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await login(email, password);
      nav("/");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell>
      <form className="card auth-card" onSubmit={submit}>
        <h2>{t("welcome")}</h2>
        <p className="muted">{t("tagline")}</p>
        <label>
          {t("email")}
          <input value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required placeholder="you@example.rw" />
        </label>
        <label>
          {t("password")}
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
        </label>
        {error && <p className="error" role="alert">{error}</p>}
        <button className="btn primary wide" disabled={busy}>{busy ? "..." : t("login")}</button>
        <LangSwitch />
        <p>
          <Link to="/register">{t("register")}</Link> · <Link to="/forgot">Forgot password?</Link>
        </p>
        <details className="demo">
          <summary>Demo accounts</summary>
          <p className="small">Password <code>password123</code>: <code>aline@example.rw</code> (learner), <code>eric@drnath.rw</code> (mentor), <code>admin@drnath.rw</code> (admin)</p>
        </details>
      </form>
    </AuthShell>
  );
}

export function Register() {
  const { register } = useAuth();
  const { t, lang } = useI18n();
  const nav = useNavigate();
  const [form, setForm] = useState({ name: "", email: "", phone: "", password: "", role: "LEARNER" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    setError("");
    try {
      const u = await register({ ...form, language: lang });
      nav(u.role === "LEARNER" ? "/survey/PRE" : "/profile");
    } catch (err) {
      setErrors(fieldErrors(err));
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell>
      <form className="card auth-card" onSubmit={submit} noValidate>
        <h2>{t("register")}</h2>
        <label>
          {t("name")}
          <input value={form.name} onChange={set("name")} autoComplete="name" aria-invalid={!!errors.name} />
          {errors.name && <span className="field-error">{errors.name}</span>}
        </label>
        <label>
          Email
          <input type="email" value={form.email} onChange={set("email")} autoComplete="email" aria-invalid={!!errors.email} />
          {errors.email && <span className="field-error">{errors.email}</span>}
        </label>
        <label>
          Phone (optional, for SMS alerts)
          <input type="tel" value={form.phone} onChange={set("phone")} placeholder="+250788123456" aria-invalid={!!errors.phone} />
          {errors.phone && <span className="field-error">{errors.phone}</span>}
        </label>
        <label>
          {t("password")}
          <input type="password" value={form.password} onChange={set("password")} autoComplete="new-password" aria-invalid={!!errors.password} />
          {errors.password && <span className="field-error">{errors.password}</span>}
        </label>
        <fieldset className="chips">
          <legend>{t("iAm")}</legend>
          {(["LEARNER", "MENTOR"] as const).map((r) => (
            <label key={r} className={`chip ${form.role === r ? "on" : ""}`}>
              <input type="radio" name="role" value={r} checked={form.role === r} onChange={set("role")} />
              {r === "LEARNER" ? t("learner") : t("mentor")}
            </label>
          ))}
        </fieldset>
        {error && !Object.keys(errors).length && <p className="error" role="alert">{error}</p>}
        <button className="btn primary wide" disabled={busy}>{t("register")}</button>
        <LangSwitch />
        <p><Link to="/login">{t("login")}</Link></p>
      </form>
    </AuthShell>
  );
}

export function Forgot() {
  const [step, setStep] = useState<"request" | "reset" | "done">("request");
  const [email, setEmail] = useState("");
  const [token, setToken] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");

  const request = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const r = await api<{ message: string }>("POST", "/api/auth/forgot", { email });
      setMsg(r.message);
      setStep("reset");
    } catch (err) {
      setError((err as Error).message);
    }
  };
  const reset = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await api("POST", "/api/auth/reset", { token, password });
      setStep("done");
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <AuthShell>
      <div className="card auth-card">
        <h2>Reset password</h2>
        {step === "request" && (
          <form onSubmit={request}>
            <label>Email or phone<input value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
            <button className="btn primary">Send reset code</button>
          </form>
        )}
        {step === "reset" && (
          <form onSubmit={reset}>
            <p className="muted">{msg}</p>
            <label>Reset code<input value={token} onChange={(e) => setToken(e.target.value)} required /></label>
            <label>New password<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={8} required /></label>
            <button className="btn primary">Set new password</button>
          </form>
        )}
        {step === "done" && <p>Your password has been changed. <Link to="/login">Log in</Link></p>}
        {error && <p className="error" role="alert">{error}</p>}
        <p><Link to="/login">Back to log in</Link></p>
      </div>
    </AuthShell>
  );
}
