# Voluntary contact sharing within the teaching team

At `/profile`, each active team account can independently share its saved email address and telephone number on its internal team profile. Both choices are off by default. The preview shows the values actually saved in Auth and the personal profile; an unsaved telephone draft is not confirmed as the shared value. The setting persists after a reload. The contact profile offers safe email and telephone actions when the saved value is suitable.

The existing `people_directory` and `person_profile` projections retain their previous scope without an email address or telephone number. A separate, narrowly scoped `person_contact(p_user_id)` function checks the active account identity, both people's current trusted team roles, profile access and the target person's explicit sharing choices on every request. Client-only and participant-only accounts do not receive staff contact details even when they can access a course profile. Administrative rank does not bypass consent. Existing separate account-management permissions remain in effect; the profile interface explains this boundary.

Preferences are stored in `private.staff_contact_visibility`, protected by RLS without direct browser grants. `contact_visibility_preferences()` reads only the current user's settings. `save_contact_visibility_preferences(p_payload,p_expected_version)` accepts only two Boolean choices and the matching version; the user's identity and contact details come from the server. A stale or concurrent save cannot overwrite a newer version. A conflict preserves the draft and offers an explicit reload. Non-team accounts cannot enable sharing.

Shared contact details are read from the current saved sources on each request, rather than maintained as a directory copy. Disabling sharing, losing a role or suspending an account prevents subsequent disclosure. Information already read by another person cannot be recalled. The interface revalidates normally stale data on focus or reconnect; an open profile requires a reload to show a visibility change immediately. A failed access check does not display retained contact details. New query keys contain both account identities, and the existing authentication boundary clears the private cache when accounts change.

Contact values are rendered as text. Email links encode the complete address so its characters cannot inject additional mail headers. Telephone links accept only simple phone numbers and typical separators; executable or parameterized content is not linked. No message is sent and no call is made automatically.

## Focused checks performed on 16 November 2026

- Eight isolated PostgreSQL test groups passed: private defaults, active team roles, exactly selected fields, client/participant/administrator boundaries, real concurrent version conflicts, manipulated input, current stored values, unchanged minimal profiles, revocation, role loss and suspension.
- Five component tests passed: safe contact actions, confirmed saving without a foreign browser-supplied ID, conflict with explicit reload, hiding retained values after denied access, hostile values and DE/EN switching.
- `scripts/staff-contact-api-check.mjs` and `tests/e2e/staff-contact.spec.ts` were created for the canonical disposable full test run. They count as passed only after actual execution; the central work log records integrated results.

```bash
node scripts/staff-contact-db-tests.mjs
npx vitest run src/features/profile/contact.test.tsx
```

No real contact details, production records or email credentials were used.
