import type {
  academyExplorerOpenApi,
  academyOpenApi,
} from "../src/features/developer-api/academy-contract.ts";

/** Stable business groups link the published contract to user-facing Academy tasks. */
const groups = {
  installation: [
    ["Installation und öffentliche Marke", "Installation and public branding"],
    "readAcademyInstallationCapabilities readAcademyPublicBranding saveAcademyWhiteLabel saveAcademyPublicBranding readAcademyPwaIcon clearAcademyPwaIcon readAcademyPublicLogo clearAcademyPublicLogo readAcademyPublicBrandLinks saveAcademyPublicBrandLinks readAcademyPwaAsset",
  ],
  authentication: [
    ["Anmeldung und Wiederherstellung", "Sign-in and recovery"],
    "humanLogin humanRecovery checkPortalAccess checkAuthenticatorSettingsAvailability",
  ],
  accounts: [
    ["Konten, Rollen und Organisationen", "Accounts, roles and organisations"],
    "readAcademyAdministration readAcademyMemberRoles changeAcademyMemberRole changeAcademyMemberActivation changeAcademyManagementDelegation createAcademyOrganisation provisionAcademyCourseAccount requestAcademyCompanyInvitation",
  ],
  settings: [
    ["Persönliche Einstellungen", "Personal settings"],
    "readOwnAcademyPersonalSettings saveOwnAcademyUsername saveOwnAcademyAppearance",
  ],
  administration: [
    [
      "Lizenz, Supportfreigaben und Protokoll",
      "Licence, support grants and audit",
    ],
    "readAcademyLicenceReceipt academySupportAccess native_admin_audit_events",
  ],
  mail: [
    [
      "Mailtransport und Verbindungstest",
      "Mail transport and connection tests",
    ],
    "readAcademyMailConfiguration saveAcademyMailConfiguration queueAcademyMailConnectionTest readAcademyMailRuntimeStatus checkAcademyMailConnection",
  ],
  notifications: [
    [
      "Benachrichtigungen und Zustellung",
      "Notifications and delivery preferences",
    ],
    "readAcademyDeliveryPreferences saveAcademyDeliveryPreferences readAcademyNotifications markOwnAcademyNotifications",
  ],
  integrations: [
    [
      "Integrationsschlüssel und Unternehmenszugriff",
      "Integration keys and company access",
    ],
    "listAcademyCourseIndexKeys issueAcademyCourseIndexKey issueAcademyScopedIntegrationKey revokeAcademyCourseIndexKey integrationCourseIndex integrationEnrolParticipant integrationCourseParticipation",
  ],
  webhooks: [
    [
      "Webhook-Abos und Zustellhistorie",
      "Webhook subscriptions and delivery history",
    ],
    "listAcademyCourseWebhooks subscribeAcademyCourseWebhook revokeAcademyCourseWebhook",
  ],
  courses: [
    [
      "Kurse, Entwürfe, Klassen und Stundenplan",
      "Courses, drafts, classes and timetable",
    ],
    "readAcademyCourseWorkspaceEntitlement readAcademyDraftOptions createAcademyCourseDraft readAcademyDraftSchedule saveAcademyDraftSchedule readAcademyCoursePublication publishAcademyCourse setAcademyCourseCapacity readAcademyCourseClass setAcademyCourseClass readAcademyTimetable listAcademyCourseWorkspaces readAcademyCourseWorkspace setAcademyCourseMeetingLink readAcademyCourseWelcome publishAcademyCourseWelcome",
  ],
  enrolment: [
    [
      "Einschreibung, Abmeldung und Lehrteam",
      "Enrolment, withdrawal and teaching team",
    ],
    "readAcademyCourseEnrolments readAcademyCourseEnrolmentCandidates manageAcademyCourseEnrolment readAcademyCourseInstructorCandidates assignAcademyCourseInstructor releaseAcademyCourseInstructor importAcademyEnrolmentRow readAcademyCourseWithdrawalWindow withdrawFromAcademyCourse listAcademyLecturerBlockOrganisations readCompanyLecturerBlocks setCompanyLecturerBlock",
  ],
  documents: [
    [
      "Kursdateien und Teilnehmerabgaben",
      "Course files and participant submissions",
    ],
    "searchAcademyCourseMaterials uploadAcademyCourseMaterial publishAcademyCourseMaterial downloadAcademyCourseDocument readAcademyCourseSubmissions setAcademyCourseSubmissions withdrawAcademyCourseSubmission",
  ],
  attendance: [
    [
      "Anwesenheit und Teilnahmeberichte",
      "Attendance and participation reports",
    ],
    "readAcademyCourseParticipationReport readAcademyCourseAttendanceSummary readAcademyCourseAttendanceRegister attachAcademyAttendanceEvidence saveAcademyCourseSessionAttendance importAcademyCourseSessionAttendance",
  ],
  exams: [
    [
      "Prüfungen, Aufgaben und Lernfortschritt",
      "Exams, learning activities and progress",
    ],
    "setAcademyCourseExamRequirement listAcademyStudentExamPdfOptions publishAcademyStudentExamPdf withdrawAcademyExamPdf saveAcademyLearningActivity course_exam_state save_course_exam_schedule submit_course_exam save_course_exam_grades published_course_exam_results",
  ],
  chat: [
    ["Kurschat und Anhänge", "Course chat and attachments"],
    "readAcademyCourseChatProtection setAcademyCourseChatProtection ensureAcademyCourseChat listAcademyCourseChatRooms readAcademyCourseChatMessages sendAcademyCourseChatAttachment sendAcademyCourseChatMessage",
  ],
  analytics: [
    ["Bewertungen und Lernanalysen", "Evaluations and learning analytics"],
    "readCourseEvaluations readCourseEvaluationComments saveCourseEvaluation readLearningAnalyticsAccess readLearningAnalyticsReport",
  ],
} as const;

const exceptions = [
  {
    action: {
      de: "Passwortvergabe, Passwortwechsel, Sitzungswechsel und TOTP",
      en: "Password setup and changes, session refresh and TOTP",
    },
    reason: {
      de: "Der Browser nutzt die Auth-Sitzung der Installation. Diese Schritte verwenden den vorhandenen Auth-Flow und keine zusätzlichen Academy-Geschäftsoperationen.",
      en: "The browser uses the installation’s Auth session. These steps use the existing Auth flow and have no additional Academy business operation.",
    },
    relatedOperations: [
      "humanLogin",
      "humanRecovery",
      "checkAuthenticatorSettingsAvailability",
    ],
  },
  {
    action: {
      de: "Logo, PWA-Symbole und spezielle Datei-Uploads veröffentlichen",
      en: "Publish logos, PWA icons and specialised file uploads",
    },
    reason: {
      de: "Die Oberfläche übernimmt den mehrstufigen Scan- und Veröffentlichungsablauf. Der Vertrag beschreibt den veröffentlichten Abruf und die unterstützten Dateioperationen; interne Upload-Modi sind keine stabile Integrationsschnittstelle.",
      en: "The interface orchestrates scanning and publishing. The contract describes published reads and supported file operations. Internal upload modes are not a stable integration API.",
    },
    relatedOperations: [
      "readAcademyPwaAsset",
      "readAcademyPublicLogo",
      "uploadAcademyCourseMaterial",
      "downloadAcademyCourseDocument",
    ],
  },
  {
    action: {
      de: "CSV/XLSX vorbereiten und Vorlagen herunterladen",
      en: "Prepare CSV/XLSX and download templates",
    },
    reason: {
      de: "Die Oberfläche liest und erzeugt Tabellen lokal. Geprüfte Zeilen werden über die jeweilige Geschäftsoperation gespeichert.",
      en: "The interface reads and generates spreadsheets locally. The corresponding business operation writes validated rows.",
    },
    relatedOperations: [
      "importAcademyEnrolmentRow",
      "importAcademyCourseSessionAttendance",
    ],
  },
  {
    action: {
      de: "Sitzungs- und Kursansichten, Live-Aktualisierung und PWA",
      en: "Session and course views, live refresh and PWA",
    },
    reason: {
      de: "Darstellung, lokale Navigation und Aktualisierung verwenden den gespeicherten Serverzustand und erzeugen keine eigenen Geschäftsaktionen.",
      en: "Rendering, local navigation and refresh use existing server state and do not create separate business operations.",
    },
    relatedOperations: [
      "readAcademyCourseWorkspace",
      "readAcademyCourseChatMessages",
      "readAcademyNotifications",
    ],
  },
  {
    action: {
      de: "Zielbetrieb, Lizenzvergabe, Backup, Wiederherstellung und Offboarding",
      en: "Operating the target, licence issuance, backup, recovery and offboarding",
    },
    reason: {
      de: "Diese Betreiberaktionen laufen auf der Zielumgebung mit getrennten Freigaben und Schlüsseln. Die Portal-API liefert nur den Lizenzbeleg und die erlaubten Supportfunktionen.",
      en: "These operator actions run on the target with separate approval and keys. The portal API exposes only the licence receipt and permitted support functions.",
    },
    relatedOperations: [
      "readAcademyInstallationCapabilities",
      "readAcademyLicenceReceipt",
      "academySupportAccess",
    ],
  },
  {
    action: { de: "Webhook-Empfang", en: "Webhook receipt" },
    reason: {
      de: "Die Academy sendet das Ereignis an den konfigurierten Empfänger. Signatur, Körper und Antwortstatus stehen im OpenAPI-Abschnitt webhooks.companyCourseEvent.",
      en: "Academy sends the event to the configured receiver. The signature, body and response statuses are defined by webhooks.companyCourseEvent in OpenAPI.",
    },
    relatedOperations: [
      "listAcademyCourseWebhooks",
      "subscribeAcademyCourseWebhook",
      "revokeAcademyCourseWebhook",
    ],
  },
] as const;

type Paths = Record<string, object>;
const aliasPrefix = "/functions/v1/portal-api/v1/";
const rpcPrefix = "/rest/v1/rpc/";

type WorkflowOperation = {
  operationId: string;
  actions?: { argument: string; values: string[] };
  endpoints: {
    method: string;
    path: string;
    operationId: string;
    statuses: string[];
    interactive: boolean;
  }[];
};

/** Assemble the downloadable workflow index and fail the build on orphaned operations. */
function academyWorkflows(paths: Paths, explorerPaths: Paths) {
  const workflows = Object.entries(groups).map(([id, [[de, en], ids]]) => ({
    id,
    title: { de, en },
    operations: ids.split(" ").map<WorkflowOperation>((operationId) => ({
      operationId,
      endpoints: [],
    })),
  }));
  const assigned = workflows.flatMap((workflow) => workflow.operations);
  const byId = new Map(
    assigned.map((operation) => [operation.operationId, operation]),
  );
  if (byId.size !== assigned.length)
    throw new Error("Duplicate Academy workflow operation");
  const nativePostIds = new Map(
    Object.entries(paths).flatMap(([path, methods]) =>
      "post" in methods
        ? [
            [
              path,
              (methods.post as { operationId: string }).operationId,
            ] as const,
          ]
        : [],
    ),
  );
  for (const [path, methods] of Object.entries(paths)) {
    for (const [method, operation] of Object.entries(methods)) {
      if (!operation?.operationId) continue;
      const original = path.startsWith(aliasPrefix)
        ? nativePostIds.get(rpcPrefix + path.slice(aliasPrefix.length))
        : operation.operationId;
      const entry = byId.get(original);
      if (!entry)
        throw new Error(
          "Missing Academy workflow for " + operation.operationId,
        );
      if (!path.startsWith(aliasPrefix)) {
        const selectors =
          operation.requestBody?.content?.["application/json"]?.schema
            ?.properties;
        for (const argument of ["p_action", "action"]) {
          const values: unknown = selectors?.[argument]?.enum;
          if (
            Array.isArray(values) &&
            values.every((value) => typeof value === "string")
          ) {
            entry.actions = { argument, values };
          }
        }
      }
      entry.endpoints.push({
        method: method.toUpperCase(),
        path,
        operationId: operation.operationId,
        statuses: Object.keys(operation.responses).sort(),
        interactive: Object.hasOwn(explorerPaths[path] ?? {}, method),
      });
    }
  }
  for (const entry of assigned)
    if (!entry.endpoints.length)
      throw new Error(
        "Missing Academy operation for workflow: " + entry.operationId,
      );
  for (const exception of exceptions)
    for (const operationId of exception.relatedOperations)
      if (!byId.has(operationId))
        throw new Error(
          "Missing Academy operation for exception: " + operationId,
        );
  return { workflows, exceptions };
}

/** Link the complete signed contract with the interactive operations on this installation. */
export function academyWorkflowIndex(
  document: ReturnType<typeof academyOpenApi>,
  explorer: ReturnType<typeof academyExplorerOpenApi>,
) {
  return {
    openapi: "/api/openapi.json",
    apiVersion: document.info.version,
    installation: document["x-portal-installation"],
    ...academyWorkflows(document.paths, explorer.paths),
  };
}
