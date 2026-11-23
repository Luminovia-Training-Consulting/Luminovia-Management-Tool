/** Only the licensed course profile is entered from a dedicated academy build. */
import {
  Link,
  Navigate,
  Outlet,
  Route,
  Routes,
  useLocation,
  useMatch,
  useOutletContext,
  useParams,
} from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { lazy } from "react";
import { useTranslation } from "react-i18next";
import { ErrorState, Loading, Notice, PageHeading } from "../components/common";
import { Preferences } from "../components/preferences";
import { Button } from "../components/ui/button";
import { academyAdministrationQuery } from "../features/accounts/academy-api";
import {
  AcademyAppearancePreferences,
  AcademyPersonalSettingsPage,
} from "../features/accounts/academy-personal-settings";
import { useAuth } from "../features/auth/auth-context";
import { AuthCallback } from "../features/auth/callback";
import { AcademyCourseAccess } from "../features/auth/installation-access";
import { Login } from "../features/auth/login";
import { PasswordRecovery } from "../features/auth/password";
import { SignOutButton } from "../features/auth/sign-out-button";
import { HelpCenter } from "../features/help/help";
import { AcademyAdministrationPage } from "../features/learning/academy-administration";
import { AcademyTimetable } from "../features/learning/academy-timetable";
import { LearningHubPage } from "../features/learning/course-hub";
import { CourseWorkspacePage } from "../features/learning/learning";
import { NotificationsMenu } from "../features/notifications/notifications-menu";
import { NotificationsPage } from "../features/notifications/notifications";
import { AcademyBrandLinksFooter } from "../features/branding/academy-brand-links-panel";
import { AcademyBrandImage } from "../features/branding/academy-logo-image";
import { AcademyBrandProvider } from "../features/branding/academy-brand-provider";
import { useAcademyBrand } from "../features/branding/academy-branding";
import { useOnline } from "../lib/online";
import { isConfigured } from "../lib/supabase";
import {
  hasLearningAnalytics,
  learningAnalyticsAccessQuery,
} from "../features/analytics/learning-api";
import "../features/analytics/learning-i18n";
import "./academy-routes.css";

const StandaloneSwagger = lazy(() =>
  import("../features/developer-api/standalone-swagger").then((module) => ({
    default: module.StandaloneSwagger,
  })),
);

const courseId =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const courseReturnRoute =
  /^(?:\/administration(?:\/mail)?|\/timetable|\/analytics\/learning|\/notifications|\/settings|\/api\/docs|\/courses\/[0-9a-f-]{36}\/workspace(?:#course-(?:overview|materials|chat|enrolments|register|exam|learning|submissions|evaluations))?)$/i;

const AcademyApiExplorer = lazy(() =>
  import("../features/developer-api/academy-explorer").then((module) => ({
    default: module.AcademyApiExplorer,
  })),
);
const LearningAnalyticsPage = lazy(() =>
  import("../features/analytics/learning").then((module) => ({
    default: module.LearningAnalyticsPage,
  })),
);
const AdminMailPage = lazy(() =>
  import("../features/admin/mail").then((module) => ({
    default: module.AdminMailPage,
  })),
);
function AcademyLogin() {
  const { session } = useAuth();
  const location = useLocation();
  const path = location.state?.returnTo;
  if (session)
    return (
      <Navigate
        to={
          typeof path === "string" && courseReturnRoute.test(path) ? path : "/"
        }
        replace
      />
    );
  return (
    <>
      <div className="login-preferences">
        <Preferences />
      </div>
      <Login footer={<AcademyBrandLinksFooter />} />
    </>
  );
}

/** Session recovery remains a native Auth flow even when the course profile is closed. */
function AcademySession() {
  const { session, loading, error } = useAuth();
  const location = useLocation();
  if (loading) return <Loading />;
  if (error) return <ErrorState />;
  if (!isConfigured || !session)
    return (
      <Navigate
        to="/login"
        replace
        state={{ returnTo: location.pathname + location.hash }}
      />
    );
  return <Outlet key={session.user.id} />;
}

function AcademyCourseProfile() {
  const swagger = useMatch("/api/swagger");
  const { session } = useAuth();
  if (!session) return null;
  return (
    <AcademyCourseAccess actor={session.user.id}>
      {(access) =>
        swagger ? (
          <Outlet context={access} />
        ) : (
          <AcademyWorkspaceFrame
            key={session.user.id}
            actor={session.user.id}
            access={access}
          />
        )
      }
    </AcademyCourseAccess>
  );
}

function AcademyWorkspaceFrame({
  actor,
  access,
}: {
  actor: string;
  access: "active" | "grace";
}) {
  const brand = useAcademyBrand();
  const online = useOnline();
  const { t, i18n } = useTranslation();
  const administration = useQuery({
    ...academyAdministrationQuery(actor),
    enabled: online,
    refetchInterval: (query) => (online && query.state.data ? 15_000 : false),
  });
  const learningAnalytics = useQuery({
    ...learningAnalyticsAccessQuery(actor),
    enabled: online,
  });
  const authority =
    online && administration.isFetchedAfterMount && administration.isSuccess
      ? administration.data
      : null;
  return (
    <>
      <a href="#academy-main" className="skip-link">
        {t("skip")}
      </a>
      <header className="academy-header">
        <Link to="/learning" className="academy-brand">
          <AcademyBrandImage fallback={brand.mark} alt="" />
          <span>{brand.name}</span>
        </Link>
        <div className="academy-header-actions">
          <AcademyTimetableLink />
          {online &&
            learningAnalytics.isSuccess &&
            hasLearningAnalytics(learningAnalytics.data) && (
              <Button variant="secondary" asChild>
                <Link to="/analytics/learning">
                  {t("learningAnalytics:title")}
                </Link>
              </Button>
            )}
          {authority && (
            <Button variant="secondary" asChild>
              <Link to="/administration">{t("academyAdministration")}</Link>
            </Button>
          )}
          <NotificationsMenu
            id={actor}
            zone={Intl.DateTimeFormat().resolvedOptions().timeZone}
            academy={access}
          />
          <Button asChild variant="secondary">
            <Link to="/settings">{t("academySettings")}</Link>
          </Button>
          <AcademyAppearancePreferences actor={actor} access={access} />
          <SignOutButton variant="secondary" />
        </div>
      </header>
      <main id="academy-main" className="academy-main" tabIndex={-1}>
        {access === "grace" && (
          <Notice>
            {i18n.language.startsWith("de")
              ? "Während der Lizenz-Kulanzfrist ist der Kursbereich schreibgeschützt."
              : "Course workspaces are read-only during the licence grace period."}
          </Notice>
        )}
        <Outlet context={access} />
      </main>
    </>
  );
}

function AcademyTimetableLink() {
  const { t } = useTranslation("academyTimetable");
  return (
    <Button variant="secondary" asChild>
      <Link to="/timetable">{t("title")}</Link>
    </Button>
  );
}

function AcademyNotFound() {
  const { t } = useTranslation();
  return (
    <div className="state">
      <PageHeading title={t("notFound")} />
      <Button asChild>
        <Link to="/">{t("goHome")}</Link>
      </Button>
    </div>
  );
}

function AcademyWorkspace() {
  const { id = "" } = useParams();
  const access = useOutletContext<"active" | "grace">();
  if (!courseId.test(id)) return <AcademyNotFound />;
  return <CourseWorkspacePage key={id} academy={access} />;
}

function AcademyCourseHub() {
  const access = useOutletContext<"active" | "grace">();
  return <LearningHubPage academy={access} />;
}

function AcademyInbox() {
  const access = useOutletContext<"active" | "grace">();
  return <NotificationsPage academy={access} />;
}

function AcademyMailSettings() {
  const access = useOutletContext<"active" | "grace">();
  return <AdminMailPage academy={access} />;
}

function AcademyTimetableRoute() {
  const { session } = useAuth();
  return session && <AcademyTimetable actor={session.user.id} />;
}

export default function AcademyRoutes() {
  const signingIn = useMatch("/login");
  const swagger = useMatch("/api/swagger");
  return (
    <AcademyBrandProvider>
      <Routes>
        <Route path="/login" element={<AcademyLogin />} />
        <Route path="/help" element={<HelpCenter />} />
        <Route path="/auth/callback" element={<AuthCallback />} />
        <Route element={<AcademySession />}>
          <Route
            path="/auth/password"
            element={
              <div className="academy-main">
                <PasswordRecovery />
              </div>
            }
          />
          <Route element={<AcademyCourseProfile />}>
            <Route index element={<Navigate to="/learning" replace />} />
            <Route path="/learning" element={<AcademyCourseHub />} />
            <Route
              path="/administration"
              element={<AcademyAdministrationPage />}
            />
            <Route
              path="/administration/mail"
              element={<AcademyMailSettings />}
            />
            <Route path="/notifications" element={<AcademyInbox />} />
            <Route path="/timetable" element={<AcademyTimetableRoute />} />
            <Route
              path="/analytics/learning"
              element={<LearningAnalyticsPage />}
            />
            <Route path="/settings" element={<AcademyPersonalSettingsPage />} />
            <Route path="/api/docs" element={<AcademyApiExplorer />} />
            <Route path="/api/swagger" element={<StandaloneSwagger />} />
            <Route
              path="/courses"
              element={<Navigate to="/learning" replace />}
            />
            <Route
              path="/courses/:id/workspace"
              element={<AcademyWorkspace />}
            />
          </Route>
        </Route>
        <Route path="*" element={<AcademyNotFound />} />
      </Routes>
      {!signingIn && !swagger && <AcademyBrandLinksFooter />}
    </AcademyBrandProvider>
  );
}
