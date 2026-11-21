/** Only the licensed course profile is entered from a dedicated academy build. */
import {
  Link,
  Navigate,
  Outlet,
  Route,
  Routes,
  useLocation,
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
import { Password } from "../features/auth/password";
import { HelpCenter } from "../features/help/help";
import { AcademyAdministrationPage } from "../features/learning/academy-administration";
import { AcademyTimetable } from "../features/learning/academy-timetable";
import { LearningHubPage } from "../features/learning/course-hub";
import { CourseWorkspacePage } from "../features/learning/learning";
import { NotificationsMenu } from "../features/notifications/notifications-menu";
import { NotificationsPage } from "../features/notifications/notifications";
import { installationBrand } from "../lib/installation-brand";
import { useOnline } from "../lib/online";
import { db, isConfigured } from "../lib/supabase";
import "./academy-routes.css";

const courseId =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const courseReturnRoute =
  /^(?:\/administration|\/timetable|\/notifications|\/settings|\/api\/docs|\/courses\/[0-9a-f-]{36}\/workspace(?:#course-(?:overview|materials|chat|enrolments|register|exam|learning))?)$/i;

const AcademyApiExplorer = lazy(() =>
  import("../features/developer-api/explorer").then(
    ({ AcademyApiExplorer }) => ({ default: AcademyApiExplorer }),
  ),
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
      <Login />
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
  const { session } = useAuth();
  const { t, i18n } = useTranslation();
  if (!session) return null;
  return (
    <AcademyCourseAccess actor={session.user.id}>
      {(access) => (
        <>
          <a href="#academy-main" className="skip-link">
            {t("skip")}
          </a>
          <header className="academy-header">
            <Link to="/learning" className="academy-brand">
              <img src={installationBrand.mark} alt="" />
              <span>{installationBrand.name}</span>
            </Link>
            <div className="academy-header-actions">
              <AcademyTimetableLink />
              <AcademyAdministrationLink actor={session.user.id} />
              <NotificationsMenu
                id={session.user.id}
                zone={Intl.DateTimeFormat().resolvedOptions().timeZone}
                academy={access}
              />
              <Button asChild variant="secondary">
                <Link to="/settings">{t("academySettings")}</Link>
              </Button>
              <AcademyAppearancePreferences
                actor={session.user.id}
                access={access}
              />
              <Button
                variant="secondary"
                onClick={() => void db().auth.signOut()}
              >
                {t("logout")}
              </Button>
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
      )}
    </AcademyCourseAccess>
  );
}

function AcademyAdministrationLink({ actor }: { actor: string }) {
  const online = useOnline();
  const { t } = useTranslation();
  const query = useQuery({
    ...academyAdministrationQuery(actor),
    enabled: online,
  });
  if (!online || !query.isFetchedAfterMount || !query.isSuccess || !query.data)
    return null;
  return (
    <Button variant="secondary" asChild>
      <Link to="/administration">{t("academyAdministration")}</Link>
    </Button>
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

function AcademyTimetableRoute() {
  const { session } = useAuth();
  return session && <AcademyTimetable actor={session.user.id} />;
}

export function AcademyRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<AcademyLogin />} />
      <Route path="/help" element={<HelpCenter />} />
      <Route path="/auth/callback" element={<AuthCallback />} />
      <Route element={<AcademySession />}>
        <Route
          path="/auth/password"
          element={
            <main className="academy-main">
              <Password />
            </main>
          }
        />
        <Route element={<AcademyCourseProfile />}>
          <Route index element={<Navigate to="/learning" replace />} />
          <Route path="/learning" element={<AcademyCourseHub />} />
          <Route
            path="/administration"
            element={<AcademyAdministrationPage />}
          />
          <Route path="/notifications" element={<AcademyInbox />} />
          <Route path="/timetable" element={<AcademyTimetableRoute />} />
          <Route path="/settings" element={<AcademyPersonalSettingsPage />} />
          <Route path="/api/docs" element={<AcademyApiExplorer />} />
          <Route
            path="/courses"
            element={<Navigate to="/learning" replace />}
          />
          <Route path="/courses/:id/workspace" element={<AcademyWorkspace />} />
        </Route>
      </Route>
      <Route path="*" element={<AcademyNotFound />} />
    </Routes>
  );
}
