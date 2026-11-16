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
import { WelcomeGuidePage } from "../features/onboarding/welcome";
import { Jobs, JobDetail } from "../features/jobs/jobs";
import { ProfilePage } from "../features/profile/profile";
// Job/profile widgets already load this module; another lazy wrapper only adds
// a loading boundary and cannot produce an independent route chunk.
import { FilesPage } from "../features/files/files";
import {
  NotificationsPage,
  SettingsPage,
} from "../features/notifications/notifications";
const AdminAuditPage = lazy(() =>
  import("../features/audit/audit").then((module) => ({
    default: module.AdminAuditPage,
  })),
);
const DemoPage = lazy(() =>
  import("../features/demo/demo").then((module) => ({
    default: module.DemoPage,
  })),
);
const HelpCenter = lazy(() =>
  import("../features/help/help").then((module) => ({
    default: module.HelpCenter,
  })),
);
const AvailabilityPage = lazy(() =>
  import("../features/availability/availability").then((module) => ({
    default: module.AvailabilityPage,
  })),
);
const TaxonomyPage = lazy(() =>
  import("../features/taxonomy/taxonomy").then((module) => ({
    default: module.TaxonomyPage,
  })),
);
const AccountsPage = lazy(() =>
  import("../features/accounts/accounts").then((module) => ({
    default: module.AccountsPage,
  })),
);
const ClientPortalPage = lazy(() =>
  import("../features/commercial/client-portal").then((module) => ({
    default: module.ClientPortalPage,
  })),
);
const PeopleDirectory = lazy(() =>
  import("../features/people/people").then((module) => ({
    default: module.PeopleDirectory,
  })),
);
const PersonProfile = lazy(() =>
  import("../features/people/people").then((module) => ({
    default: module.PersonProfile,
  })),
);
const MyCourseReviews = lazy(() =>
  import("../features/people/reviews").then((module) => ({
    default: module.MyCourseReviews,
  })),
);
const ContractsPage = lazy(() =>
  import("../features/commercial/contracts").then((module) => ({
    default: module.ContractsPage,
  })),
);
const FinancePage = lazy(() =>
  import("../features/commercial/finance").then((module) => ({
    default: module.FinancePage,
  })),
);
const ClientsPage = lazy(() =>
  import("../features/operations/clients").then((module) => ({
    default: module.ClientsPage,
  })),
);
const CoursesPage = lazy(() =>
  import("../features/operations/courses").then((module) => ({
    default: module.CoursesPage,
  })),
);
const PortalSearch = lazy(() =>
  import("../features/search/search").then((module) => ({
    default: module.PortalSearch,
  })),
);
const WikiPage = lazy(() =>
  import("../features/knowledge/wiki").then((module) => ({
    default: module.WikiPage,
  })),
);
const ForumPage = lazy(() =>
  import("../features/knowledge/forum").then((module) => ({
    default: module.ForumPage,
  })),
);
const ChatPage = lazy(() =>
  import("../features/chat/chat").then((module) => ({
    default: module.ChatPage,
  })),
);
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
    // Auth clears remote queries separately. Remount private local state too
    // when a different account signs in through another tab/native Auth event.
    <Outlet key={session.user.id} />
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
          <Route path="/demo/*" element={<DemoPage />} />
          <Route path="/help" element={<HelpCenter />} />
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
              <Route path="welcome" element={<WelcomeGuidePage />} />
              <Route path="jobs" element={<Jobs />} />
              <Route path="jobs/:id" element={<JobDetailRoute />} />
              <Route path="calendar" element={<CalendarPage />} />
              <Route path="chats" element={<ChatPage />} />
              <Route path="search" element={<PortalSearch />} />
              <Route path="clients" element={<ClientsPage />} />
              <Route path="client" element={<ClientPortalPage />} />
              <Route path="people" element={<PeopleDirectory />} />
              <Route path="people/:id" element={<PersonProfile />} />
              <Route path="my-reviews" element={<MyCourseReviews />} />
              <Route path="courses" element={<CoursesPage />} />
              <Route path="contracts" element={<ContractsPage />} />
              <Route path="finance" element={<FinancePage />} />
              <Route path="wiki" element={<WikiPage />} />
              <Route path="forum" element={<ForumPage />} />
              <Route path="files" element={<FilesPage />} />
              <Route path="profile" element={<ProfilePage />} />
              <Route path="notifications" element={<NotificationsPage />} />
              <Route path="settings" element={<SettingsPage />} />
              <Route path="topics" element={<TaxonomyPage />} />
              <Route path="availability" element={<AvailabilityPage />} />
              <Route path="security" element={<Security />} />
              <Route path="auth/password" element={<Password />} />
              <Route path="admin" element={<AdminNavigation />}>
                <Route index element={<AdminPage />} />
                <Route path="people" element={<PeopleAdminPage />} />
                <Route path="accounts" element={<AccountsPage />} />
                <Route path="audit" element={<AdminAuditPage />} />
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
