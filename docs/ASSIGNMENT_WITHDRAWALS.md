# Assignment withdrawal requests

This implements the later product instruction that lecturer withdrawals with less
than seven days' notice need review. Ordinary job claims remain immediately
confirmed, first-come, first-served; this adds no claim approval queue.

## Lecturer and management flow

Open the confirmed job and choose **Withdraw from this assignment**. The displayed
window comes from PostgreSQL. At least seven days (168 elapsed hours) before the
first session, a direct withdrawal can be confirmed; its reason is optional. At
less than seven days, the dialog requires a 5–1000-character reason and submits a
pending application. It never removes calendar sessions or chat access while the
application is waiting. The submission transaction checks the time again, so an
old browser dialog cannot bypass the boundary.

Administration or Management opens the inbox notice, follows the job link, reads
the application and chooses approval or rejection with a decision note. Current
`jobs.manage` and AAL2 are required. A requester cannot approve their own work.
Approval cancels the entire claimed block atomically. Rejection leaves the
assignment confirmed. The lecturer receives the outcome in the inbox and sees the
note in the job. A rejection can be followed by a new application. If administrative
cancellation or substitution overtakes the application, it is closed as superseded.

Direct withdrawal or approval retains accepted fees, currency, terms, source and
contract snapshots, releases every session, removes assignment-only course-chat
membership and returns the vacancy to draft. Explicit participant-room membership,
other confirmed assignments and current enrolments retain access. Management explicitly reopens it.
Started or invoiced assignments require separate operational/financial review;
this feature does not create refunds, payments or accounting records.

Participant-room memberships created before source tracking are deliberately
unknown. If no other confirmed assignment or enrolment proves access, release
stops atomically until an authorized room manager uses **Resolve access basis**
to record independent access or a current assignment/enrolment basis. The former
survives release; the latter is removed once its last supporting source ends.
The same explicit decision is required before removing an enrolment when its remaining legacy chat membership has no recorded origin. A room owner is not silently removed. An authorized manager may explicitly remove
an unneeded member once no assignment or enrolment retains access. These decisions
are recorded in the audit trail. Existing ambiguous rows are never auto-classified.

## API and privacy

| RPC                                                                             | Result and scope                                                                                                                                     |
| ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `resolve_participant_chat_origin(p_room,p_user,p_independent)` | A current authorized room manager explicitly records the basis of a participant-room membership. |
| `assignment_withdrawals(p_job_id)`                                              | Current actor's confirmed claims and own applications, or current authorized management applications. Null job selects a bounded cross-job snapshot. |
| `request_assignment_withdrawal(p_claim_id,p_reason,p_request_id)`               | Own confirmed future assignment only; returns application ID and current status.                                                                     |
| `review_assignment_withdrawal(p_withdrawal_id,p_approve,p_reason,p_request_id)` | Current management capability, MFA and non-author check; approves or rejects a pending application once.                                             |

Public wrappers are security invoker, private implementations have an empty
search path and explicit authenticated grants. Private application/command tables
have RLS and no client table grants. Reasons are plain authored text in private
application storage. Inbox rows contain only a kind and resource ID; link targets
are reauthorized when read. No private calendar, contract or DM administrator
bypass is added. No real email delivery is activated by implementing these notices.

Mutations require online confirmation. Actor-scoped UI caches refresh after a
confirmed response; uncertain responses retain the same request UUID for retry.
The command ledger binds actor, operation and payload; a changed payload cannot
reuse an old command. A rejected application needs a fresh explicit operation.
The existing lecturer/job/claim locks also serialize invoices, substitutions and
competing decisions. The old cancellation RPC refuses own short-notice attempts,
including actors who also have a management role. Directed substitutions and the
replacement marketplace enforce the same rule: an own proposal cannot be created
inside the window, and an older own proposal cannot release its source after aging
into it. Short-notice transfers remain possible when a different current authorized
manager explicitly initiated them. Their immutable server-written proposer ID and
current management role are checked under profile locks before release; a revoked
or suspended proposer no longer authorizes the transfer.

## Migration and operations

Apply `20261116170334_assignment_withdrawal_requests.sql` and the following
`20261117120000_participant_chat_membership_origins.sql` only through the existing
reviewed migration/update procedure. It adds private workflow tables, a cancellation
trigger and scoped RPCs; published prior migrations stay unchanged. Existing claims
and commercial rows are preserved, with no invented historical applications.
This code change does not install the migration in any hosted or ordinary database.

Revert application code through the existing recovery procedure if necessary;
do not drop application records or rewrite accepted history to roll back. Pending
applications require an authorized operational decision. Preserve workflow tables
in backups with the rest of the database. PR and QA records describe checks actually
executed; source/component tests alone do not prove native Auth, HTTP, retained data
or production readiness.
