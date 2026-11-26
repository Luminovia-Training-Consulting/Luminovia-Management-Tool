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
import { lazy, Suspense } from "react";
import { useTranslation } from "react-i18next";
import { PageNotFound } from "../components/page-not-found";
import { ErrorState, Loading, Notice } from "../components/common";
import { Preferences } from "../components/preferences";
import { Button } from "../components/ui/button";
import { academyAdministrationQuery } from "../features/accounts/academy-api";
import { AcademySupportAccessPage } from "../features/accounts/academy-support";
import {
  AcademyAppearancePreferences,
  AcademyPersonalSettingsPage,
} from "../features/accounts/academy-personal-settings";
import { useAuth } from "../features/auth/auth-context";
import { SwaggerRoute } from "../features/developer-api/swagger-route";
import { AuthCallback } from "../features/auth/callback";
import { AcademyCourseAccess } from "../features/auth/installation-access";
import { Login } from "../features/auth/login";
import { PasswordRecovery } from "../features/auth/password";
import { SignOutButton } from "../features/auth/sign-out-button";
import { HelpCenter } from "../features/help/help";
import { AcademyAdministrationPage } from "../features/learning/academy-administration";
import { LearningHubPage } from "../features/learning/course-hub";
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
import "../features/learning/academy-timetable-i18n";
import "./academy-routes.css";

const AcademyTimetable = lazy(() =>
  import("../features/learning/academy-timetable").then((module) => ({
    default: module.AcademyTimetable,
  })),
);
const LtiAuthorize = lazy(() =>
  import("../features/learning/lti-course").then((module) => ({
    default: module.LtiAuthorize,
  })),
);
const LtiDeepLinkReview = lazy(() =>
  import("../features/learning/lti-course").then((module) => ({
    default: module.LtiDeepLinkReview,
  })),
);
const CourseWorkspacePage = lazy(() =>
  import("../features/learning/learning").then((module) => ({
    default: module.CourseWorkspacePage,
  })),
);

const StandaloneSwagger = lazy(() =>
  import("../features/developer-api/standalone-swagger").then((module) => ({
    default: module.StandaloneSwagger,
  })),
);

const courseId =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const courseReturnRoute =
  /^(?:\/administration(?:\/(?:mail|audit))?|\/timetable|\/support\/access|\/analytics\/learning|\/notifications|\/settings|\/api\/(?:docs|swagger)|\/courses\/[0-9a-f-]{36}\/workspace(?:#course-(?:overview|materials|chat|enrolments|register|exam|learning|submissions|evaluations))?)$/i;

const AcademyAuditPage = lazy(() =>
  import("../features/audit/audit").then((module) => ({
    default: module.AcademyAuditPage,
  })),
);
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
    <div className="login-page">
      <div className="login-preferences">
        <Preferences />
      </div>
      <Login footer={<AcademyBrandLinksFooter />} />
    </div>
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
        <Suspense fallback={<Loading />}>
          <Outlet context={access} />
        </Suspense>
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

function AcademyWorkspace() {
  const { id = "" } = useParams();
  const access = useOutletContext<"active" | "grace">();
  if (!courseId.test(id)) return <PageNotFound />;
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
        <Route path="/lti/authorize" element={<LtiAuthorize />} />
        <Route path="/lti/selection" element={<LtiDeepLinkReview />} />
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
          <Route
            path="/support/access"
            element={<AcademySupportAccessPage />}
          />
          <Route element={<AcademyCourseProfile />}>
            <Route index element={<Navigate to="/learning" replace />} />
            <Route path="/learning" element={<AcademyCourseHub />} />
            <Route
              path="/administration"
              element={<AcademyAdministrationPage />}
            />
            <Route
              path="/administration/audit"
              element={<AcademyAuditPage />}
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
            <Route
              path="/api/docs"
              element={
                <SwaggerRoute>
                  <AcademyApiExplorer />
                </SwaggerRoute>
              }
            />
            <Route
              path="/api/swagger"
              element={
                <SwaggerRoute>
                  <StandaloneSwagger />
                </SwaggerRoute>
              }
            />
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
        <Route path="*" element={<PageNotFound standalone />} />
      </Routes>
      {!signingIn && !swagger && <AcademyBrandLinksFooter />}
    </AcademyBrandProvider>
  );
}
