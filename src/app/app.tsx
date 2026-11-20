import {SectionHub} from "./section-hubs";
/**
 * SPA routes, global error boundary and PWA notices. Public Auth, demo and help routes stay
 * outside the protected user-keyed subtree; feature pages load on demand.
 */
import {Component, lazy, type ReactNode, Suspense} from "react";
import {Navigate, Outlet, Route, Routes, useParams} from "react-router-dom";
import {useTranslation} from "react-i18next";
import {useRegisterSW} from "virtual:pwa-register/react";
import {useAuth} from "../features/auth/auth-context";
import {PortalAccess} from "../features/auth/portal-access";
import {AuthCallback} from "../features/auth/callback";
import {Login} from "../features/auth/login";
import {Password} from "../features/auth/password";
import {AdminNavigation} from "../features/admin/navigation";
import {Preferences, Shell} from "./shell";
import {ErrorState, Loading, Notice} from "../components/common";
import {isConfigured} from "../lib/supabase";
import {useOnline} from "../lib/online";
import {Button} from "../components/ui/button";
import {Dashboard} from "../features/dashboard/dashboard";
import {WelcomeGuidePage} from "../features/onboarding/welcome";
import {JobDetail, Jobs} from "../features/jobs/jobs";
import {ProfilePage} from "../features/profile/profile";
// Job/profile widgets already load this module; another lazy wrapper only adds
// a loading boundary and cannot produce an independent route chunk.
import {FilesPage} from "../features/files/files";
// The shared shell/provider and contextual actions already load this module.
import {DeletionsPage} from "../features/deletions/deletions";

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
const AdminMailPage = lazy(() =>
    import("../features/admin/mail").then((module) => ({
        default: module.AdminMailPage,
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
const ReplacementMarketplacePage = lazy(() =>
    import("../features/replacements/replacements").then((module) => ({
        default: module.ReplacementMarketplacePage,
    })),
);
const EnquiriesPage = lazy(() =>
    import("../features/enquiries/enquiries").then((module) => ({
        default: module.EnquiriesPage,
    })),
);
const LearningHubPage = lazy(() =>
    import("../features/learning/learning").then((module) => ({
        default: module.LearningHubPage,
    })),
);

const ControlCenterPage = lazy(() =>
    import("../features/workbench/control-center").then((module) => ({
        default: module.ControlCenterPage,
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

/** Wait for session resolution before entering private routes; remount local state when the actor changes. */
function Protected() {
    const {session, loading, error} = useAuth();
    if (loading) return <Loading/>;
    if (error) return <ErrorState/>;
    return isConfigured && session ? (
        // Auth clears remote queries separately. Remount private local state too
        // when a different account signs in through another tab/native Auth event.
        <PortalAccess key={session.user.id}>
            <Outlet/>
        </PortalAccess>
    ) : (
        <Navigate to="/login" replace/>
    );
}

/** Expose offline/update state and activate a new service worker only through the visible user action. */
function AppNotices() {
    const {t} = useTranslation();
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

/** Compose public Auth/demo/help routes and protected feature pages under one Suspense boundary. */
export function App() {
    return (
        <>
            <AppNotices/>
            <Suspense fallback={<Loading/>}>
                <Routes>
                    <Route path="/demo/*" element={<DemoPage/>}/>
                    <Route path="/help" element={<HelpCenter/>}/>
                    <Route
                        path="/login"
                        element={
                            <>
                                <div className="login-preferences">
                                    <Preferences/>
                                </div>
                                <Login/>
                            </>
                        }
                    />
                    <Route path="/auth/callback" element={<AuthCallback/>}/>
                    <Route element={<Protected/>}>
                        <Route element={<Shell/>}>
                            <Route index element={<Dashboard/>}/>
                            <Route path="welcome" element={<WelcomeGuidePage/>}/>
                            <Route path="jobs" element={<Jobs/>}/>
                            <Route path="jobs/:id" element={<JobDetailRoute/>}/>
                            <Route path="calendar" element={<CalendarPage/>}/>
                            <Route path="chats" element={<ChatPage/>}/>
                            <Route path="search" element={<PortalSearch/>}/>
                            <Route path="clients" element={<ClientsPage/>}/>
                            <Route path="client" element={<ClientPortalPage/>}/>
                            <Route path="people" element={<PeopleDirectory/>}/>
                            <Route path="people/:id" element={<PersonProfile/>}/>
                            <Route path="my-reviews" element={<MyCourseReviews/>}/>
                            <Route path="courses" element={<SectionHub kind="courses"/>}/>
                            <Route path="readiness" element={<CourseReadinessPage/>}/>
                            <Route path="readiness/:id" element={<CourseReadinessPage/>}/>
                            <Route
                                path="delivery"
                                element={<Navigate to="/courses" replace/>}
                            />
                            <Route path="support" element={<SupportDeskPage/>}/>
                            <Route path="support/:id" element={<SupportDeskPage/>}/>
                            <Route
                                path="replacements"
                                element={<ReplacementMarketplacePage/>}
                            />
                            <Route path="enquiries" element={<EnquiriesPage/>}/>
                            <Route path="enquiries/:id" element={<EnquiriesPage/>}/>
                            <Route path="learning" element={<LearningHubPage/>}/>
                            <Route path="workbench" element={<Navigate to="/" replace/>}/>
                            <Route
                                path="timesheets"
                                element={<Navigate to="/finance" replace/>}
                            />
                            <Route path="control-center" element={<ControlCenterPage/>}/>
                            <Route
                                path="courses/:id/workspace"
                                element={<CourseWorkspacePage/>}
                            />
                            <Route path="contracts" element={<ContractsPage/>}/>
                            <Route path="finance" element={<FinancePage/>}/>
                            <Route path="wiki" element={<SectionHub kind="knowledge"/>}/>
                            <Route path="forum" element={<SectionHub kind="updates"/>}/>
                            <Route path="files" element={<FilesPage/>}/>
                            <Route path="profile" element={<ProfilePage/>}/>
                            <Route path="notifications" element={<NotificationsPage/>}/>
                            <Route path="announcements" element={<AnnouncementsPage/>}/>
                            <Route path="settings" element={<SettingsPage/>}/>
                            <Route path="topics" element={<TaxonomyPage/>}/>
                            <Route
                                path="availability"
                                element={<Navigate to="/calendar" replace/>}
                            />
                            <Route
                                path="security"
                                element={<Navigate to="/settings" replace/>}
                            />
                            <Route path="auth/password" element={<Password/>}/>
                            <Route path="admin" element={<AdminNavigation/>}>
                                <Route index element={<AdminPage/>}/>
                                <Route path="people" element={<PeopleAdminPage/>}/>
                                <Route path="clients" element={<ClientsPage/>}/>
                                <Route path="accounts" element={<AccountsPage/>}/>
                                <Route path="mail" element={<AdminMailPage/>}/>
                                <Route path="deletions" element={<DeletionsPage/>}/>
                                <Route path="audit" element={<AdminAuditPage/>}/>
                                <Route
                                    path="announcements"
                                    element={<AdminAnnouncementsPage/>}
                                />
                            </Route>
                        </Route>
                    </Route>
                    <Route path="*" element={<NotFound/>}/>
                </Routes>
            </Suspense>
        </>
    );
}

/** Discard detail drafts and retry identities when navigation selects a different job ID. */
function JobDetailRoute() {
    const {id} = useParams();
    return <JobDetail key={id}/>;
}

/** Offer a translated, accessible route back from an unknown URL. */
function NotFound() {
    const {t} = useTranslation();
    return (
        <div className="state">
            <h1>{t("notFound")}</h1>
            <Button asChild>
                <a href="/">{t("goHome")}</a>
            </Button>
        </div>
    );
}

/** Catch render failures and show a fixed bilingual fallback instead of a blank application. */
export class ErrorBoundary extends Component<
    { children: ReactNode },
    { hasError: boolean }
> {
    state = {hasError: false};

    static getDerivedStateFromError() {
        return {hasError: true};
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