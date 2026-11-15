import { Component, lazy, Suspense, type ReactNode } from "react";
import { Navigate, Outlet, Route, Routes, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useRegisterSW } from "virtual:pwa-register/react";
import { useAuth } from "../features/auth/auth-context";
import { AuthCallback } from "../features/auth/callback";
import { Login } from "../features/auth/login";
import { Password } from "../features/auth/password";
import { Security } from "../features/auth/security";
import { AdminNavigation } from "../features/admin/navigation";
import { Shell, Preferences } from "./shell";
import { Loading, ErrorState, Notice } from "../components/common";
import { isConfigured } from "../lib/supabase";
import { useOnline } from "../lib/online";
import { Button } from "../components/ui/button";
import { Dashboard } from "../features/dashboard/dashboard";
import { Jobs, JobDetail } from "../features/jobs/jobs";
import { ProfilePage } from "../features/profile/profile";
const CalendarPage = lazy(() =>
  import("../features/calendar/calendar").then((module) => ({
    default: module.CalendarPage,
  })),
);
const PeopleAdminPage = lazy(() =>
  import("../features/admin/people").then((module) => ({
    default: module.PeopleAdminPage,
  })),
);
const AdminPage = lazy(() =>
  import("../features/admin/admin").then((module) => ({
    default: module.AdminPage,
  })),
);
function Protected() {
  const { session, loading, error } = useAuth();
  if (loading) return <Loading />;
  if (error) return <ErrorState />;
  return isConfigured && session ? (
    <Outlet />
  ) : (
    <Navigate to="/login" replace />
  );
}
function AppNotices() {
  const { t } = useTranslation();
  const online = useOnline();
  const {
    needRefresh: [refresh, setRefresh],
    updateServiceWorker,
  } = useRegisterSW();
  return (
    <>
      {!online && (
        <div className="connection-banner" role="status">
          {t("offline")}
        </div>
      )}
      {refresh && (
        <div className="update-banner" role="status">
          <span>{t("updatedApp")}</span>
          <Button onClick={() => void updateServiceWorker(true)}>
            {t("update")}
          </Button>
          <Button variant="ghost" onClick={() => setRefresh(false)}>
            {t("later")}
          </Button>
        </div>
      )}
    </>
  );
}
export function App() {
  return (
    <>
      <AppNotices />
      <Suspense fallback={<Loading />}>
        <Routes>
          <Route
            path="/login"
            element={
              <>
                <div className="login-preferences">
                  <Preferences />
                </div>
                <Login />
              </>
            }
          />
          <Route path="/auth/callback" element={<AuthCallback />} />
          <Route element={<Protected />}>
            <Route element={<Shell />}>
              <Route index element={<Dashboard />} />
              <Route path="jobs" element={<Jobs />} />
              <Route path="jobs/:id" element={<JobDetailRoute />} />
              <Route path="calendar" element={<CalendarPage />} />
              <Route path="profile" element={<ProfilePage />} />
              <Route path="security" element={<Security />} />
              <Route path="auth/password" element={<Password />} />
              <Route path="admin" element={<AdminNavigation />}>
                <Route index element={<AdminPage />} />
                <Route path="people" element={<PeopleAdminPage />} />
              </Route>
            </Route>
          </Route>
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
    </>
  );
}
function JobDetailRoute() {
  const { id } = useParams();
  return <JobDetail key={id} />;
}
function NotFound() {
  const { t } = useTranslation();
  return (
    <div className="state">
      <h1>{t("notFound")}</h1>
      <Button asChild>
        <a href="/">{t("goHome")}</a>
      </Button>
    </div>
  );
}
export class ErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  render() {
    return this.state.hasError ? (
      <div className="state">
        <Notice kind="error">
          Luminovia Portal · Bitte neu laden. / Please reload.
        </Notice>
        <Button onClick={() => window.location.reload()}>
          Neu laden / Reload
        </Button>
      </div>
    ) : (
      this.props.children
    );
  }
}
