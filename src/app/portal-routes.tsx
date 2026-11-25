/**
 * Routes for the internal operations portal. Public Auth and help routes
 * stay outside the protected user-keyed subtree.
 */
import { lazy } from "react";
import { FinanceWorkspace, LegacyFinanceRoute } from "./finance-workspace";
import {
  CommunicationForum,
  CommunicationWorkspace,
  LegacyForumRoute,
  LegacyWikiRoute,
  SectionHub,
} from "./section-hubs";
import {
  Navigate,
  Outlet,
  Route,
  Routes,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { useAuth } from "../features/auth/auth-context";
import { SwaggerRoute } from "../features/developer-api/swagger-route";
import { PortalAccess } from "../features/auth/portal-access";
import { AuthCallback } from "../features/auth/callback";
import { Login } from "../features/auth/login";
import { PasswordRecovery } from "../features/auth/password";
import {
  AdminNavigation,
  AdministrationSection,
} from "../features/admin/navigation";
import { isAssignmentRequest } from "../features/admin/navigation-links";
import { Shell } from "./shell";
import { Preferences } from "../components/preferences";
import { ErrorState, Loading } from "../components/common";
import { PageNotFound } from "../components/page-not-found";
import { isConfigured } from "../lib/supabase";
// The shared shell/provider and contextual actions already load this module.
import { DeletionsPage } from "../features/deletions/deletions";

const Dashboard = lazy(() =>
  import("../features/dashboard/dashboard").then((module) => ({
    default: module.Dashboard,
  })),
);
const WelcomeGuidePage = lazy(() =>
  import("../features/onboarding/welcome").then((module) => ({
    default: module.WelcomeGuidePage,
  })),
);
const ChangeRequestsPage = lazy(() =>
  import("../features/changes/changes").then((module) => ({
    default: module.ChangeRequestsPage,
  })),
);
const JobDetail = lazy(() =>
  import("../features/jobs/jobs").then((module) => ({
    default: module.JobDetail,
  })),
);
const ProfilePage = lazy(() =>
  import("../features/profile/profile").then((module) => ({
    default: module.ProfilePage,
  })),
);
const FilesPage = lazy(() =>
  import("../features/files/files").then((module) => ({
    default: module.FilesPage,
  })),
);

const JobDiscovery = lazy(() =>
  import("../features/jobs/discovery").then((module) => ({
    default: module.JobDiscovery,
  })),
);

const StandaloneSwagger = lazy(() =>
  import("../features/developer-api/standalone-swagger").then((module) => ({
    default: module.StandaloneSwagger,
  })),
);

const DeliveryPage = lazy(() =>
  import("../features/changes/delivery").then((module) => ({
    default: module.DeliveryPage,
  })),
);
const AnnouncementsPage = lazy(() =>
  import("../features/announcements/announcements").then((module) => ({
    default: module.AnnouncementsPage,
  })),
);
const NotificationsPage = lazy(() =>
  import("../features/notifications/notifications").then((module) => ({
    default: module.NotificationsPage,
  })),
);
const SettingsPage = lazy(() =>
  import("../features/notifications/notifications").then((module) => ({
    default: module.SettingsPage,
  })),
);

const AdminAuditPage = lazy(() =>
  import("../features/audit/audit").then((module) => ({
    default: module.AdminAuditPage,
  })),
);
const AdminAnnouncementsPage = lazy(() =>
  import("../features/announcements/admin").then((module) => ({
    default: module.AdminAnnouncementsPage,
  })),
);
const WhiteLabelSetupPage = lazy(() =>
  import("../features/admin/white-label-setup").then((module) => ({
    default: module.WhiteLabelSetupPage,
  })),
);
const PlatformResetPage = lazy(() =>
  import("../features/admin/platform-reset").then((module) => ({
    default: module.PlatformResetPage,
  })),
);
const PlatformResetStatus = lazy(() =>
  import("../features/admin/platform-reset").then((module) => ({
    default: module.PlatformResetStatus,
  })),
);
const AdminMailPage = lazy(() =>
  import("../features/admin/mail").then((module) => ({
    default: module.AdminMailPage,
  })),
);
const ApiExplorer = lazy(() =>
  import("../features/developer-api/portal-explorer").then((module) => ({
    default: module.ApiExplorer,
  })),
);
const HelpCenter = lazy(() =>
  import("../features/help/help").then((module) => ({
    default: module.HelpCenter,
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

const AnalyticsPage = lazy(() =>
  import("../features/analytics/analytics").then((module) => ({
    default: module.AnalyticsPage,
  })),
);

const LearningAnalyticsPage = lazy(() =>
  import("../features/analytics/learning").then((module) => ({
    default: module.LearningAnalyticsPage,
  })),
);

const AccountingPage = lazy(() =>
  import("../features/accounting/accounting").then((module) => ({
    default: module.AccountingPage,
  })),
);

const ClientsPage = lazy(() =>
  import("../features/operations/clients").then((module) => ({
    default: module.ClientsPage,
  })),
);

const CourseReadinessPage = lazy(() =>
  import("../features/readiness/readiness").then((module) => ({
    default: module.CourseReadinessPage,
  })),
);

const SupportDeskPage = lazy(() =>
  import("../features/support/support").then((module) => ({
    default: module.SupportDeskPage,
  })),
);
const EnquiriesPage = lazy(() =>
  import("../features/enquiries/enquiries").then((module) => ({
    default: module.EnquiriesPage,
  })),
);
const LearningHubPage = lazy(() =>
  import("../features/learning/course-hub").then((module) => ({
    default: module.LearningHubPage,
  })),
);

const ControlCenterPage = lazy(() =>
  import("../features/workbench/control-center").then((module) => ({
    default: module.ControlCenterPage,
  })),
);
const CourseCloseoutFollowupRoute = lazy(() =>
  import("../features/learning/course-closeout-followup").then((module) => ({
    default: module.CourseCloseoutFollowupRoute,
  })),
);

const CourseWorkspacePage = lazy(() =>
  import("../features/learning/learning").then((module) => ({
    default: module.CourseWorkspacePage,
  })),
);

const PortalSearch = lazy(() =>
  import("../features/search/search").then((module) => ({
    default: module.PortalSearch,
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

const AdminPage = lazy(() =>
  import("../features/admin/admin").then((module) => ({
    default: module.AdminPage,
  })),
);

/** Wait for session resolution before entering private routes; remount local state when the actor changes. */
function Protected() {
  const { session, loading, error } = useAuth();
  if (loading) return <Loading />;
  if (error) return <ErrorState />;
  if (!isConfigured || !session) return <Navigate to="/login" replace />;
  // Auth clears remote queries separately. Remount private local state too
  // when a different account signs in through another tab/native Auth event.
  return (
    <PortalAccess key={session.user.id}>
      <Outlet />
    </PortalAccess>
  );
}

export default function PortalRoutes() {
  return (
    <Routes>
      <Route path="/help" element={<HelpCenter />} />
      <Route
        path="/login"
        element={
          <div className="login-page">
            <div className="login-preferences">
              <Preferences />
            </div>
            <Login />
          </div>
        }
      />
      <Route path="/auth/callback" element={<AuthCallback />} />
      <Route path="/reset-status" element={<PlatformResetStatus />} />
      <Route element={<Protected />}>
        <Route
          path="/api/swagger"
          element={
            <SwaggerRoute>
              <StandaloneSwagger />
            </SwaggerRoute>
          }
        />
        <Route element={<Shell />}>
          <Route index element={<Dashboard />} />
          <Route path="welcome" element={<WelcomeGuidePage />} />
          <Route path="jobs" element={<JobDiscovery />} />
          <Route path="jobs/:id" element={<JobDetailRoute />} />
          <Route path="calendar" element={<CalendarPage />} />
          <Route path="chats" element={<CommunicationWorkspace />}>
            <Route index element={<ChatPage />} />
            <Route path="forum" element={<CommunicationForum />} />
          </Route>
          <Route path="search" element={<PortalSearch />} />
          <Route path="client" element={<ClientPortalPage />} />
          <Route
            path="my-reviews"
            element={
              <SectionHub kind="courses" current="reviews">
                <MyCourseReviews />
              </SectionHub>
            }
          />
          <Route path="courses" element={<SectionHub kind="courses" />} />
          <Route
            path="readiness"
            element={
              <SectionHub kind="courses" current="readiness">
                <CourseReadinessPage />
              </SectionHub>
            }
          />
          <Route
            path="readiness/:id"
            element={
              <SectionHub kind="courses" current="readiness">
                <CourseReadinessPage />
              </SectionHub>
            }
          />
          <Route
            path="delivery"
            element={
              <SectionHub kind="courses" current="delivery">
                <DeliveryPage />
              </SectionHub>
            }
          />
          <Route
            path="support"
            element={
              <SectionHub kind="assistance" current="support">
                <SupportDeskPage />
              </SectionHub>
            }
          />
          <Route
            path="support/:id"
            element={
              <SectionHub kind="assistance" current="support">
                <SupportDeskPage />
              </SectionHub>
            }
          />
          <Route
            path="replacements"
            element={<Navigate to="/jobs" replace />}
          />
          <Route path="enquiries" element={<EnquiriesPage />} />
          <Route path="enquiries/:id" element={<EnquiriesPage />} />
          <Route path="learning" element={<LearningHubPage />} />
          <Route path="workbench" element={<CourseCloseoutFollowupRoute />} />
          <Route
            path="timesheets"
            element={<Navigate to="/finance" replace />}
          />
          <Route
            path="courses/:id/workspace"
            element={<CourseWorkspacePage />}
          />
          <Route path="finance" element={<FinanceWorkspace scope="personal" />}>
            <Route index element={<FinancePage />} />
            <Route
              path="accounting"
              element={<AccountingPage key="personal" scope="personal" />}
            />
            <Route
              path="analytics"
              element={<AnalyticsPage key="personal" scope="personal" />}
            />
            <Route
              path="analytics/learning"
              element={
                <LearningAnalyticsPage key="personal" scope="personal" />
              }
            />
          </Route>
          <Route
            path="client/finance"
            element={<FinanceWorkspace scope="company" />}
          >
            <Route
              path="accounting"
              element={<AccountingPage key="company" scope="company" />}
            />
            <Route
              path="analytics"
              element={<AnalyticsPage key="company" scope="company" />}
            />
            <Route
              path="analytics/learning"
              element={<LearningAnalyticsPage key="company" scope="company" />}
            />
          </Route>
          <Route
            path="analytics"
            element={<LegacyFinanceRoute to="/finance/analytics" />}
          />
          <Route
            path="analytics/learning"
            element={<LegacyFinanceRoute to="/finance/analytics/learning" />}
          />
          <Route
            path="accounting"
            element={<LegacyFinanceRoute to="/finance/accounting" />}
          />
          <Route path="wiki" element={<LegacyWikiRoute />} />
          <Route path="assistance" element={<SectionHub kind="assistance" />} />
          <Route path="forum" element={<LegacyForumRoute />} />
          <Route path="files" element={<FilesPage />} />
          <Route path="profile" element={<ProfilePage />} />
          <Route path="notifications" element={<NotificationsPage />} />
          <Route path="announcements" element={<AnnouncementsPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route
            path="api/docs"
            element={
              <SwaggerRoute>
                <ApiExplorer />
              </SwaggerRoute>
            }
          />
          <Route
            path="availability"
            element={<Navigate to="/calendar" replace />}
          />
          <Route
            path="security"
            element={<Navigate to="/settings" replace />}
          />
          <Route path="auth/password" element={<PasswordRecovery />} />
          <Route element={<AdminNavigation />}>
            <Route path="clients" element={<ClientsPage />} />
            <Route
              path="reset"
              element={<Navigate to="/admin/reset" replace />}
            />
            <Route path="people" element={<PeopleDirectory />} />
            <Route path="people/:id" element={<PersonProfile />} />
            <Route path="control-center" element={<ControlCenterPage />} />
            <Route path="topics" element={<TaxonomyPage />} />
            <Route path="contracts" element={<ContractsPage />} />
            <Route path="changes" element={<ChangeRequestsPage />} />
            <Route path="changes/:id" element={<ChangeRequestsPage />} />
            <Route path="admin">
              <Route index element={<AdministrationIndex />} />
              <Route
                path="operations"
                element={<AdministrationSection area="operations" />}
              />
              <Route
                path="directory"
                element={<AdministrationSection area="directory" />}
              />
              <Route
                path="platform"
                element={<AdministrationSection area="platform" />}
              />
              <Route
                path="finance"
                element={<FinanceWorkspace scope="staff" />}
              >
                <Route
                  index
                  element={<FinancePage key="staff" scope="staff" />}
                />
                <Route
                  path="accounting"
                  element={<AccountingPage key="staff" scope="staff" />}
                />
                <Route
                  path="analytics"
                  element={<AnalyticsPage key="staff" scope="staff" />}
                />
                <Route
                  path="analytics/learning"
                  element={<LearningAnalyticsPage key="staff" scope="staff" />}
                />
              </Route>
              <Route path="assignments" element={<AdminPage />} />
              <Route path="people" element={<LegacyLecturersRoute />} />
              <Route path="clients" element={<ClientsPage />} />
              <Route path="accounts" element={<AccountsPage />} />
              <Route path="mail" element={<AdminMailPage />} />
              <Route path="white-label" element={<WhiteLabelSetupPage />} />
              <Route path="reset" element={<PlatformResetPage />} />
              <Route path="deletions" element={<DeletionsPage />} />
              <Route path="audit" element={<AdminAuditPage />} />
              <Route
                path="announcements"
                element={<AdminAnnouncementsPage />}
              />
            </Route>
          </Route>
        </Route>
      </Route>
      <Route path="*" element={<PageNotFound standalone />} />
    </Routes>
  );
}

/** Keep bookmarks for the former separate expertise directory working. */
function LegacyLecturersRoute() {
  const [params] = useSearchParams();
  const id = params.get("user");
  return (
    <Navigate
      replace
      to={
        id && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id)
          ? `/people/${id}?expertise=1`
          : "/people"
      }
    />
  );
}

/** Preserve assignment links published before the administration overview. */
function AdministrationIndex() {
  const [params] = useSearchParams();
  return isAssignmentRequest(params) ? (
    <AdminPage />
  ) : (
    <AdministrationSection />
  );
}

/** Discard detail drafts and retry identities when navigation selects a different job ID. */
function JobDetailRoute() {
  const { id } = useParams();
  return <JobDetail key={id} />;
}
