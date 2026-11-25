import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "./auth";
import { I18nProvider } from "./i18n";
import { startOutbox } from "./offline/outbox";
import Layout from "./components/Layout";
import { Forgot, Login, Register } from "./pages/Auth";
import { ChallengeDetail, Challenges, LearnerHome } from "./pages/Learner";
import StageWork from "./pages/StageWork";
import { Portfolio, PublicPortfolio, Verify } from "./pages/Portfolio";
import { Notifications, Profile, Survey } from "./pages/Account";
import { MentorQueue, MentorReview } from "./pages/Mentor";
import { AdminAudit, AdminChallenges, AdminDashboard, AdminUsers } from "./pages/Admin";
import "@fontsource-variable/urbanist";
import "@fontsource/poppins/400.css";
import "@fontsource/poppins/500.css";
import "@fontsource/poppins/600.css";
import "./styles.css";
import "./dege.css";

function Home() {
  const { user } = useAuth();
  if (user?.role === "MENTOR") return <MentorQueue />;
  if (user?.role === "ADMIN") return <AdminDashboard />;
  return <LearnerHome />;
}

function App() {
  const { user, loading } = useAuth();
  if (loading && !user) return <p className="splash">Dr. Nath</p>;
  return (
    <Routes>
      {/* Public pages: employers verify badges and view shared portfolios without an account. */}
      <Route path="/verify/:id" element={<Verify />} />
      <Route path="/p/:slug" element={<PublicPortfolio />} />
      {!user ? (
        <>
          <Route path="/register" element={<Register />} />
          <Route path="/forgot" element={<Forgot />} />
          <Route path="*" element={<Login />} />
        </>
      ) : (
        <Route element={<Layout />}>
          <Route index element={<Home />} />
          <Route path="challenges" element={<Challenges />} />
          <Route path="challenges/:id" element={<ChallengeDetail />} />
          <Route path="stages/:stageId" element={<StageWork />} />
          <Route path="portfolio" element={<Portfolio />} />
          <Route path="survey/:type" element={<Survey />} />
          <Route path="notifications" element={<Notifications />} />
          <Route path="profile" element={<Profile />} />
          <Route path="review/:submissionId" element={<MentorReview />} />
          {user.role === "ADMIN" && (
            <>
              <Route path="admin/challenges" element={<AdminChallenges />} />
              <Route path="admin/users" element={<AdminUsers />} />
              <Route path="admin/audit" element={<AdminAudit />} />
            </>
          )}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      )}
    </Routes>
  );
}

startOutbox();
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => void navigator.serviceWorker.register("/sw.js"));
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <I18nProvider>
      <AuthProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </AuthProvider>
    </I18nProvider>
  </StrictMode>,
);
