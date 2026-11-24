/** Bilingual strings for administrator-only mail transport settings and safe connection status. */
import i18n from "../../lib/i18n";

const de = {
  deliveryFailures: "Fehlgeschlagene Zustellungen",
  deliveryFailuresHelp:
    "Hier stehen die letzten 80 offenen Fehler bei Einladungen und Kursmails.",
  noDeliveryFailures: "Keine offenen Zustellfehler.",
  refreshFailures: "Zustellstatus aktualisieren",
  failedCourseMail: "Kursmail",
  failedInvitation: "Einladung",
  recipientUnavailable: "Keine bestätigte Empfängeradresse",
  recipientRejected: "Empfängeradresse abgewiesen",
  senderRejected: "Absenderadresse abgewiesen",
  outcomeUncertain: "Annahme durch den Mailserver unklar",
  checkBeforeRetry:
    "Prüfe beim Mailanbieter, ob diese Nachricht bereits angenommen wurde.",
  correctedRecipient: "Empfängeradresse für die Einladung",
  verifiedRecipientHint:
    "Kursmails gehen an die bestätigte Adresse des zugehörigen Kontos. Die betroffene Person kann die Adresse in den eigenen Kontoeinstellungen unter „Zugangsdaten“ ändern. Sobald die Änderung bestätigt ist, kannst du diese Kursmail erneut anstoßen.",
  retryDelivery: "Zustellung erneut anstoßen",
  retrying: "Zustellung wird bearbeitet …",
  retryQueued: "Die Kursmail wurde erneut in die Warteschlange gestellt.",
  inviteAccepted: "Der Einladungsdienst hat den Versand bestätigt.",
  inviteChecking:
    "Der Einladungsversand wird bearbeitet. Prüfe den Zustellstatus erneut.",
  retryFailed:
    "Der Wiederholungsversuch wurde nicht bestätigt. Prüfe den aktualisierten Zustellstatus.",
  title: "E-Mail-Transport",
  setupTitle: "Einrichtung prüfen",
  smtpConfigured: "SMTP ist aktiviert und Zugangsdaten sind gespeichert.",
  smtpIncomplete: "SMTP ist deaktiviert oder Zugangsdaten fehlen.",
  relayConfigured:
    "Der private Mail-Relay ist in der Installation konfiguriert.",
  relayMissing: "Der Mail-Relay fehlt. Prüfe die Serverkonfiguration.",
  relayUnknown: "Status des Mail-Relays ist derzeit nicht verfügbar.",
  invitationEnabled: "Der Server erlaubt E-Mail-Einladungen.",
  invitationDisabled:
    "E-Mail-Einladungen sind serverseitig gesperrt. Prüfe die Einladungseinstellung der Installation.",
  invitationUnknown:
    "Der Status der E-Mail-Einladungen ist derzeit nicht verfügbar.",
  connectionScope:
    "Der Verbindungstest prüft TLS und die Anmeldung beim Mailanbieter. Eine Testmail geht an die bestätigte E-Mail-Adresse deines Portalkontos.",
  description:
    "SMTP wird für Authentifizierung und Portalbenachrichtigungen gemeinsam verwendet. Zugangsdaten werden nur verschlüsselt gespeichert und nie erneut angezeigt.",
  academyDescription:
    "Richte den SMTP-Transport für Einladungen und die Passwort-Wiederherstellung dieser Akademie ein. Du kannst die Verbindung prüfen oder dir eine Testmail schicken. Zugangsdaten werden verschlüsselt gespeichert.",
  academyReadOnly:
    "Der E-Mail-Transport ist während der Kulanzfrist schreibgeschützt.",
  academyOnline:
    "Verbinde dich mit dem Internet, um den E-Mail-Transport zu öffnen.",
  smtp: "Ausgehender SMTP-Transport",
  imap: "Optionaler IMAP-Eingang",
  enabled: "Aktiviert",
  host: "Server",
  port: "Port",
  security: "TLS-Verfahren",
  hostingerDefault: "Hostinger · SSL/TLS (465)",
  hostingerAlternative: "Hostinger · STARTTLS (587)",
  implicitTls: "Implizites TLS",
  startTls: "STARTTLS",
  senderEmail: "Absender-E-Mail",
  senderName: "Absendername",
  username: "Benutzername",
  password: "Passwort",
  credentialsConfigured: "Zugangsdaten sind verschlüsselt gespeichert.",
  leaveBlank: "Leer lassen, um gespeicherte Zugangsdaten beizubehalten.",
  testReady: "Speichere die Verbindungseinstellungen, bevor du sie testest.",
  save: "Einstellungen speichern",
  saving: "Speichern …",
  saved: "E-Mail-Einstellungen wurden gespeichert.",
  loadFailed: "Die E-Mail-Einstellungen konnten nicht geladen werden.",
  saveFailed: "Die E-Mail-Einstellungen konnten nicht bestätigt werden.",
  conflict: "Die Einstellungen wurden parallel geändert. Bitte neu laden.",
  smtpTest: "SMTP-Verbindung testen",
  sendTestMail: "Testmail an mich senden",
  testMailAccepted:
    "Der SMTP-Server hat die Testmail angenommen. Prüfe deinen Posteingang und Spamordner.",
  testMailUnconfirmed:
    "Der Versand wurde nicht bestätigt. Prüfe zuerst den Posteingang und ob die E-Mail-Adresse deines Portalkontos bestätigt ist.",
  credentialSaved: "Gespeichert",
  incompleteCredentials:
    "Aktiviere den Transport und gib Benutzername und Passwort gemeinsam ein. Gespeicherte Zugangsdaten kannst du unverändert lassen.",
  imapTest: "IMAP-Verbindung testen",
  testing: "Verbindung wird geprüft …",
  testPassed: "Die Verbindung wurde erfolgreich geprüft.",
  testFailed: "Die Verbindung konnte nicht bestätigt werden.",
  statusPending: "Ausstehend",
  statusRunning: "Wird geprüft",
  statusSucceeded: "Erfolgreich",
  statusFailed: "Fehlgeschlagen",
  errorConnect: "Server nicht erreichbar",
  errorTls: "TLS-Verbindung fehlgeschlagen",
  errorAuth: "Anmeldung abgelehnt",
  errorProtocol: "Serverprotokoll nicht unterstützt",
  errorTimeout: "Zeitlimit überschritten",
  errorChanged: "Einstellungen wurden während des Tests geändert",
  errorUnavailable: "Die Verbindung ist nicht vollständig konfiguriert",
  noPermission: "Für die E-Mail-Verwaltung ist Administration erforderlich.",
};
const en: typeof de = {
  deliveryFailures: "Failed deliveries",
  deliveryFailuresHelp:
    "The latest 80 unresolved invitation and course mail failures.",
  noDeliveryFailures: "No unresolved delivery failures.",
  refreshFailures: "Refresh delivery status",
  failedCourseMail: "Course mail",
  failedInvitation: "Invitation",
  recipientUnavailable: "No verified recipient address",
  recipientRejected: "Recipient address rejected",
  senderRejected: "Sender address rejected",
  outcomeUncertain: "Mail server acceptance is uncertain",
  checkBeforeRetry:
    "Check with the mail provider whether this message was already accepted.",
  correctedRecipient: "Invitation recipient address",
  verifiedRecipientHint:
    "Course mail goes to the verified address of the linked account. The account holder can change the address under Account credentials in their own settings. Once the change is confirmed, retry this course email here.",
  retryDelivery: "Retry delivery",
  retrying: "Processing delivery …",
  retryQueued: "Course mail was put back in the delivery queue.",
  inviteAccepted: "The invitation service confirmed sending.",
  inviteChecking:
    "Invitation delivery is in progress. Check the delivery status again.",
  retryFailed:
    "The retry could not be confirmed. Check the updated delivery status.",
  title: "Mail transport",
  setupTitle: "Setup status",
  smtpConfigured: "SMTP is enabled and credentials are stored.",
  smtpIncomplete: "SMTP is disabled or credentials are missing.",
  relayConfigured:
    "The private mail relay is configured for this installation.",
  relayMissing: "The mail relay is missing. Check the server configuration.",
  relayUnknown: "The mail relay status is currently unavailable.",
  invitationEnabled: "The server allows email invitations.",
  invitationDisabled:
    "The server blocks email invitations. Check the installation's invitation setting.",
  invitationUnknown: "The email invitation status is currently unavailable.",
  connectionScope:
    "The connection test checks TLS and authentication with the mail provider. A test email goes to the verified email address of your portal account.",
  description:
    "SMTP is shared by Auth and portal notifications. Credentials are stored encrypted and are never displayed again.",
  academyDescription:
    "Configure SMTP for invitations and password recovery in this academy. You can check the connection or send yourself a test email. Credentials are stored encrypted.",
  academyReadOnly:
    "Mail transport is read-only during the licence grace period.",
  academyOnline: "Connect to the internet to open mail transport settings.",
  smtp: "Outbound SMTP transport",
  imap: "Optional inbound IMAP",
  enabled: "Enabled",
  host: "Server",
  port: "Port",
  security: "TLS mode",
  hostingerDefault: "Hostinger · SSL/TLS (465)",
  hostingerAlternative: "Hostinger · STARTTLS (587)",
  implicitTls: "Implicit TLS",
  startTls: "STARTTLS",
  senderEmail: "Sender email",
  senderName: "Sender name",
  username: "Username",
  password: "Password",
  credentialsConfigured: "Credentials are stored encrypted.",
  leaveBlank: "Leave blank to keep the stored credentials.",
  testReady: "Save the connection settings before testing them.",
  save: "Save settings",
  saving: "Saving …",
  saved: "Mail settings were saved.",
  loadFailed: "Mail settings could not be loaded.",
  saveFailed: "Mail settings could not be confirmed.",
  conflict: "Settings changed concurrently. Reload and try again.",
  smtpTest: "Test SMTP connection",
  sendTestMail: "Send me a test email",
  testMailAccepted:
    "The SMTP server accepted the test email. Check your inbox and spam folder.",
  testMailUnconfirmed:
    "Sending could not be confirmed. Check your inbox and confirm that your portal account email address is verified.",
  credentialSaved: "Saved",
  incompleteCredentials:
    "Enable the transport and enter the username and password together. You can keep your saved credentials.",
  imapTest: "Test IMAP connection",
  testing: "Testing connection …",
  testPassed: "The connection test succeeded.",
  testFailed: "The connection could not be confirmed.",
  statusPending: "Pending",
  statusRunning: "Testing",
  statusSucceeded: "Succeeded",
  statusFailed: "Failed",
  errorConnect: "Server could not be reached",
  errorTls: "TLS connection failed",
  errorAuth: "Authentication was rejected",
  errorProtocol: "Server protocol was not accepted",
  errorTimeout: "Connection timed out",
  errorChanged: "Settings changed during the test",
  errorUnavailable: "The connection is not fully configured",
  noPermission: "Mail administration requires an administrator account.",
};
i18n.addResourceBundle("de", "adminMail", de);
i18n.addResourceBundle("en", "adminMail", en);
