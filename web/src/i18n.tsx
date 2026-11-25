import { createContext, useContext, useState, type ReactNode } from "react";

// English / Kinyarwanda interface (FR1.3, NFR8).
// NOTE: Kinyarwanda strings are a first draft and must be reviewed by a native speaker before the pilot.
const dict = {
  en: {
    home: "Home",
    challenges: "Challenges",
    portfolio: "Portfolio",
    profile: "Profile",
    queue: "Review queue",
    dashboard: "Dashboard",
    users: "Users",
    audit: "Audit log",
    logout: "Log out",
    login: "Log in",
    register: "Create an account",
    email: "Email or phone number",
    password: "Password",
    name: "Full name",
    iAm: "I am a",
    learner: "Learner",
    mentor: "Mentor",
    welcome: "Welcome back",
    tagline: "Practise real problem-solving with mentor feedback.",
    search: "Search challenges...",
    all: "All",
    enrol: "Enrol",
    continue: "Continue",
    stage: "Stage",
    of: "of",
    submit: "Submit for review",
    savedOffline: "Saved on this device",
    synced: "Saved",
    offline: "Offline",
    pending: "queued",
    recommended: "Recommended for you",
    myChallenges: "My challenges",
    badges: "Badges",
    completed: "Completed projects",
    share: "Share portfolio link",
    notifications: "Notifications",
    language: "Language",
  },
  rw: {
    home: "Ahabanza",
    challenges: "Ibibazo",
    portfolio: "Ibyo nakoze",
    profile: "Umwirondoro",
    queue: "Ibyo gusuzuma",
    dashboard: "Imbonerahamwe",
    users: "Abakoresha",
    audit: "Igitabo cy'ibikorwa",
    logout: "Sohoka",
    login: "Injira",
    register: "Fungura konti",
    email: "Imeri cyangwa nimero ya telefoni",
    password: "Ijambobanga",
    name: "Amazina yose",
    iAm: "Ndi",
    learner: "Umunyeshuri",
    mentor: "Umujyanama",
    welcome: "Murakaza neza",
    tagline: "Iga gukemura ibibazo nyabyo ufashijwe n'umujyanama.",
    search: "Shakisha ibibazo...",
    all: "Byose",
    enrol: "Iyandikishe",
    continue: "Komeza",
    stage: "Icyiciro",
    of: "kuri",
    submit: "Ohereza bisuzumwe",
    savedOffline: "Byabitswe kuri iki gikoresho",
    synced: "Byabitswe",
    offline: "Nta interineti",
    pending: "bitegereje",
    recommended: "Ibyo tukugiriye inama",
    myChallenges: "Ibibazo byanjye",
    badges: "Impeta",
    completed: "Imishinga yarangiye",
    share: "Sangiza ibyo wakoze",
    notifications: "Ubutumwa",
    language: "Ururimi",
  },
} as const;

export type Lang = keyof typeof dict;
export type Key = keyof (typeof dict)["en"];

const Ctx = createContext<{ lang: Lang; setLang: (l: Lang) => void; t: (k: Key) => string }>({ lang: "en", setLang: () => {}, t: (k) => dict.en[k] });

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => (localStorage.getItem("drnath.lang") as Lang) || "en");
  const setLang = (l: Lang) => {
    localStorage.setItem("drnath.lang", l);
    document.documentElement.lang = l;
    setLangState(l);
  };
  return <Ctx.Provider value={{ lang, setLang, t: (k) => dict[lang][k] }}>{children}</Ctx.Provider>;
}

export const useI18n = () => useContext(Ctx);
