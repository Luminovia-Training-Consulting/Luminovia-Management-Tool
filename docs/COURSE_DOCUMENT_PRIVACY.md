# Course resources and dedicated private documents

Migration `20261116065156` keeps dedicated Support attachments, website-enquiry
attachments and external customer-invoice evidence outside course sharing. Its
private helper checks the actual optional registry tables by document identity
when they exist. The helper has no external-role execution grant.

Current course selection, share creation, resource projection and exact download
facts all apply this exclusion. It also protects existing links after a document
has acquired a dedicated binding. Sharing takes the current actor profile lock,
rechecks authority, then locks the document and exact version before checking
the registry again. A trigger is always installed on this module's course-resource
table, so the course side works when either module is installed first.

Normal teaching materials remain available through their exact clean shared
version and current course audience. Their private owner's general file visibility
does not become a prerequisite for an enrolled learner's authorised course access.
The Edge gateway retains its second current-access read before returning bytes.

The corresponding enquiry registration RPC uses the same document lock and checks
all course-resource history, including removed links. This prevents a formerly
shared teaching document from later becoming a private enquiry attachment. Other
domains must preserve their own authenticated registration checks and locking.

## Executed evidence and boundaries

The automatic `course-document-privacy-db-tests.mjs` suite is self-contained. Its
test-only SQL/JSON fixture records source identities and hashes for minimal
optional registry metadata plus an unchanged actual enquiry registration RPC
excerpt. It deliberately omits unrelated Support/accounting/intake workflows.

Actual focused results: **18 new PostgreSQL groups**, **11 existing course groups**,
six strict routine/trigger diagnostics without issues, lint/format/diff checks
and independent exact-definition review. The cases cover normal exact-version
sharing, all three dedicated registries, selection/share/read/download-facts/
restore denials, both installation orders, removed history and two observed
document-lock races in opposite directions. These are metadata/SQL permission
checks, not a completed full foreign-module or real Edge/Auth/Storage acceptance.

At the inspected unmerged domain-source checkpoints, ordinary public attachment
APIs perform document-lock/history checks; complete direct-registry INSERT
course-history triggers were not present in all three domains. Their owners must
retain or complete those boundaries independently. This course migration does
not claim to repair foreign source, enable its APIs or deploy its modules.
