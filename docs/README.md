# Documentation

Start with the guide for your task. User workflows describe current source behavior; QA records describe named executed checkpoints. Neither establishes that a hosted instance has the current source or that production is approved.

| Task                              | Start here                                                                                                    |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Run this checkout                 | [Local development](LOCAL_DEVELOPMENT.md)                                                                     |
| Preview latest main separately    | [GitHub local preview](GITHUB_LOCAL_PREVIEW.md)                                                               |
| Learn the application             | [User guide](USER_GUIDE.md), [demo and help](GUIDED_DEMO_AND_HELP.md)                                         |
| Change the application            | [Contributing](../CONTRIBUTING.md), [developer guide](DEVELOPER_GUIDE.md), [agent instructions](../AGENTS.md) |
| Integrate an API                  | [API reference](API_REFERENCE.md), [architecture](ARCHITECTURE.md), [data model](ERD.md)                      |
| Understand remaining requirements | [Roadmap](../ROADMAP.md), [product specification](PRODUCT_SPEC.md)                                            |
| Assess tests or releases          | [Functional acceptance](FUNCTIONAL_ACCEPTANCE.md), [QA results](QA_RESULTS.md), [CI profiles](CI_QUALITY.md)  |
| Operate an authorized environment | [Deployment runbook](DEPLOYMENT_RUNBOOK.md), [operations](OPERATIONS.md)                                      |
| Report a vulnerability            | [Private reporting](../SECURITY.md)                                                                           |

Documentation uses English; the application supports German/English and user-authored content retains its language. The original [master brief](UNIVERSAL_MASTER_PROMPT.txt) and [operations extension brief](OPERATIONS_EXTENSION_PROMPT.txt) remain verbatim historical requirements. Later explicit user decisions take precedence. The separate implementation plan, work log and root changelog were removed at Carina's request; validation belongs in the relevant guide and PR, without recreating those files.

## Product and user workflows

- [product specification](PRODUCT_SPEC.md)
- [user guide](USER_GUIDE.md)
- [Smart operations — approved product extension](SMART_OPERATIONS_SPEC.md)
- [Guided exploration and help](GUIDED_DEMO_AND_HELP.md)
- [Personal welcome guide](WELCOME_GUIDE.md)
- [Personal dashboard and teaching day](PERSONAL_DASHBOARD.md)
- [Personal dashboard overview](DASHBOARD.md)
- [Find jobs and save private views](JOB_DISCOVERY.md)
- [Jobs: lifecycle, lecturer positions and board](JOB_LIFECYCLE.md)
- [Purpose-scoped offer and course choices](JOB_PICKERS.md)
- [Assignment waitlists and consented substitution](ASSIGNMENT_HANDOVER.md)
- [Transactional replacement marketplace](REPLACEMENT_MARKETPLACE.md)
- [Course building blocks, source references and teaching offers](COURSE_BUILDING_BLOCKS.md)
- [Course workspaces, preparation and learning evidence](COURSE_LEARNING_WORKSPACE.md)
- [Course Readiness Centre](COURSE_READINESS.md)
- [Attendance and proof of teaching delivery](TEACHING_DELIVERY.md)
- [Customer request teaching briefs](CLIENT_REQUEST_BRIEFS.md)
- [Internal support desk](SUPPORT_DESK.md)
- [Private workbench and reusable workflows](WORKBENCH.md)
- [Actual teaching time, financial facts and Control Center](TIMESHEETS_FINANCE_CONTROL_CENTER.md)
- [Calendar: private events, assignments and published global events](CALENDAR.md)
- [Personal calendar files](CALENDAR_EXPORT.md)
- [Calendar subscriptions and explicit offline teaching preview](CALENDAR_CONNECTIONS.md)
- [Availability and blocked periods](AVAILABILITY.md)
- [Shared topic and tool catalogue](TAXONOMY.md)
- [Profiles, personal labels, course history and reviews](PROFILES_REVIEWS.md)
- [Qualification evidence and verification](QUALIFICATIONS.md)
- [Personal qualification passport](QUALIFICATION_PASSPORT.md)
- [Profile pictures and their permission boundary](PROFILE_AVATARS.md)
- [Freiwillige Kontaktfreigabe im Dozierendenteam](STAFF_CONTACT_VISIBILITY.md)
- [Chat, structured mentions and group moderation](CHAT.md)
- [File centre: search, personal tags and virtual folders](FILES.md)
- [Comments on templates and jobs](RESOURCE_COMMENTS.md)
- [Portal announcements](ANNOUNCEMENTS.md)
- [Notifications and preferences](NOTIFICATIONS.md)
- [Web Push on desktop and mobile](WEB_PUSH.md)
- [Administrative audit log](ADMIN_AUDIT.md)

## Architecture, API and source contracts

- [Architecture and decisions](ARCHITECTURE.md)
- [Relational model and permission boundaries](ERD.md)
- [Platform API reference](API_REFERENCE.md)
- [Reading and safely extending SQL migrations](MIGRATION_GUIDE.md)
- [Developer guide](DEVELOPER_GUIDE.md)
- [Accounts, course profiles and commission model](ACCOUNTS_REVENUE_SPEC.md)
- [Delegated roles and private compensation](DELEGATED_ROLES_PRICING.md)
- [Verified Luminovia brand and portal design system](BRAND_DESIGN_SYSTEM.md)
- [Primary reference sources and version checks](REFERENCE_SOURCES.md)

## Security and permission reviews

- [Security and privacy release checklist](SECURITY_PRIVACY_CHECKLIST.md)
- [Backend review — integrated local portal](BACKEND_SECURITY_REVIEW.md)
- [Scoped account and commission server audit](ACCOUNTS_PLATFORM_AUDIT.md)
- [Collaboration access and verification](CHAT_SECURITY.md)
- [Wiki and forum access, content and verification](KNOWLEDGE_SECURITY.md)
- [Executed contracts, compensation and invoice tracking](COMMERCIAL_SECURITY.md)
- [Client accounts and private commission tracking](CLIENT_COMMISSION_SECURITY.md)
- [Course resources and dedicated private documents](COURSE_DOCUMENT_PRIVACY.md)
- [Historical CodeQL baseline review](CODE_SCANNING_TRIAGE.md)
- [Dependency audit](DEPENDENCY_AUDIT.md)

## Development, verification and operation

- [Local application and persistence](LOCAL_DEVELOPMENT.md)
- [Try the latest GitHub version locally](GITHUB_LOCAL_PREVIEW.md)
- [PR checks and local preview packages](PR_PREVIEWS.md)
- [GitHub checks, security and coverage](CI_QUALITY.md)
- [Verification plan and acceptance evidence](TEST_PLAN.md)
- [Functional and integration acceptance](FUNCTIONAL_ACCEPTANCE.md)
- [QA evidence — 2026-11-16](QA_RESULTS.md)
- [Functional and code-connection audit](FUNCTIONAL_CODE_AUDIT.md)
- [System audit: functionality, performance and failure paths](SYSTEM_AUDIT.md)
- [Guided experience functional and connectivity audit](GUIDED_EXPERIENCE_AUDIT.md)
- [Deployment and operations runbook](DEPLOYMENT_RUNBOOK.md)
- [Customers and reusable course operations](OPERATIONS.md)
- [Hostinger self-hosted development instance](HOSTINGER_DEVELOPMENT.md)
- [Automatic development updates](HOSTINGER_AUTOMATIC_UPDATES.md)
- [KVM1 development performance](KVM1_PERFORMANCE.md)
- [Transactional notification email delivery](NOTIFICATION_DELIVERY_DATABASE.md)
- [Notification email delivery](NOTIFICATION_MAIL_OPERATIONS.md)
- [M4 development migration review](REVIEWED_M4_MIGRATIONS.md)
- [Explicit reviewed migration plans](REVIEWED_MIGRATION_PLANS.md)

## Contribution and integration references

- [Creating and working on issues](ISSUE_GUIDE.md)
- [Creating, reviewing and merging pull requests](PULL_REQUEST_GUIDE.md)
- [GitHub administration and contribution workflow](GITHUB_WORKFLOW.md)
- [Collaboration, knowledge and commercial frontend](COLLABORATION_AND_COMMERCIAL_IMPLEMENTATION.md)
- [Seven additional operational modules](OPERATIONS_EXTENSION_STATUS.md)
- [Seven-module extension: ownership and integration audit](EXTENSION_COORDINATION.md)
- [Operational notification and handover integration](OPERATIONAL_FORWARD_INTEGRATION.md)
- [Recipient-specific handover integration](ROLE_AWARE_HANDOVER_INTEGRATION.md)
- [Accepted amendment forecast integration](AMENDMENT_FORECAST_BRIDGE.md)
- [Dedicated support evidence and course-resource registries](SUPPORT_COURSE_RESOURCE_REGRESSION.md)
- [Historical PR CI repair — 16 November 2026](PR_CI_REPAIR_20261116.md)

## Decisions and assets

[Decision notes](decisions/README.md) record lasting documentation, governance and evidence conventions. [Brand provenance](BRAND_DESIGN_SYSTEM.md) explains official assets under `public/brand/`. Screenshots under `docs/screenshots/` are historical fictional captures, not evidence of current hosted installation.

Keep credentials, private records and unredacted traces outside Git. Production, hosting/DNS changes, risky data operations and real-message delivery require their own authorization.
