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
import { useTranslation } from "react-i18next";
import { ErrorState, Loading, Notice, PageHeading } from "../components/common";
import { Preferences } from "../components/preferences";
import { Button } from "../components/ui/button";
import { useAuth } from "../features/auth/auth-context";
import { AuthCallback } from "../features/auth/callback";
import { AcademyCourseAccess } from "../features/auth/installation-access";
import { Login } from "../features/auth/login";
import { Password } from "../features/auth/password";
import { HelpCenter } from "../features/help/help";
import { LearningHubPage } from "../features/learning/course-hub";
import { CourseWorkspacePage } from "../features/learning/learning";
import { installationBrand } from "../lib/installation-brand";
import { db, isConfigured } from "../lib/supabase";
import "./academy-routes.css";

const courseId =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const courseReturnRoute =
  /^\/courses\/[0-9a-f-]{36}\/workspace(?:#course-(?:overview|materials|chat|enrolments|register|exam))?$/i;

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
              <Preferences />
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
          <Route path="/learning" element={<LearningHubPage academy />} />
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
