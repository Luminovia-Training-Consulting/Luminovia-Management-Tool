# Creating and working on issues

A useful issue describes a reproducible problem or a verifiable goal. Start with the [GitHub issue chooser](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/issues/new/choose). Please write new issues in English so everyone can follow the discussion. The overall contribution process is in [CONTRIBUTING](../CONTRIBUTING.md).

## Before opening an issue

Search open and closed issues as well as active pull requests. For an apparently missing product feature, check the [current implementation plan](IMPLEMENTATION_PLAN.md). A feature listed as pending can be clarified in a proposal; it should not be reported as a broken workflow that has already been delivered.

Keep each issue focused on one related problem. Report unrelated bugs separately so their reproduction, tests and resolution remain clear.

## Reporting bugs

Use the bug report form and include:

- A short, specific title, such as File list does not show the replaced version after reopening.
- The commit or development release, browser and operating system, and the affected test account's role.
- The smallest reproducible sequence of steps using fictional data.
- Expected and observed behaviour, including the exact error message.
- Impact and frequency; for scheduling problems, include the date, time and IANA time zone.
- Sanitised screenshots or relevant log lines when helpful.

For startup problems, include the command you ran, Node and Docker versions, and the visible error. The [local development guide](LOCAL_DEVELOPMENT.md) explains services, ports and persistence. Do not delete required volumes or reset a normal database to reproduce a problem.

Remove tokens, passwords, authentication callback URLs, QR codes, personal data and private document contents from every attachment. Do not upload raw `.local` directories, Playwright traces, HAR files or database backups. Even seemingly useful network logs can contain sessions and private responses.

## Proposing features and improvements

Start with who has the problem and what is missing today. Describe the desired workflow and verifiable acceptance criteria. Identify affected roles, views and permissions, and any consequences for existing data.

For example: After a course assignment is revoked, the existing lecturer account can no longer download that course's private files, even with its unchanged session. A general request for something secure and user-friendly is not a verifiable acceptance criterion.

Technical suggestions are welcome. Significant schema changes, additional services and changes to accepted financial agreements require a reasoned discussion before implementation.

## Questions and documentation gaps

Use the appropriate form for a question or documentation improvement. Link to the specific page and explain what is missing or contradictory. Code questions should include a small sanitised example and the intended outcome.

## Reporting security vulnerabilities

Do **not publish suspected vulnerabilities, exploit instructions, stolen data or credentials in a public issue or pull request**. This is especially important for permission bypasses, private files, sessions and financial data.

Private vulnerability reporting is enabled for this repository. Use [Report a vulnerability](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/security/advisories/new) in the Security area. This sends the details privately to the responsible maintainers. If you cannot access the form, use an already agreed private contact route to `CarinaSchoppe`; do not post the technical details publicly instead.

A private report should include the affected commit, a minimal reproduction using fictional data, the expected permission boundary and the impact. Do not access additional real accounts or data to expand the finding.

## Triage and labels

Maintainers review reports, request clarification when needed and apply labels. Existing labels such as `bug`, `documentation`, `question`, `duplicate`, `good first issue` and `help wanted` remain available. Related pull requests also need the required [type, area and risk labels](PULL_REQUEST_GUIDE.md#pull-request-labels).

You do not need permission to manage labels to open an issue. Mention the likely area in the description. Use `good first issue` and `help wanted` to find suitable tasks; a label does not guarantee a particular scope or review time.

## From report to fix

1. Reproduce the problem and agree on the intended behaviour.
2. Someone takes ownership of the change and links the issue in their pull request.
3. The fix receives appropriate tests and updated documentation.
4. The pull request is merged after its checks and any required review. `Closes #123` automatically closes the linked issue.

Maintainers and repository administrators may use their PR-only review exception; required CI and commit signatures still apply. Auto-Merge waits for the active requirements. See the [pull request guide](PULL_REQUEST_GUIDE.md#review-rules-for-main) for the review and merge rules.

A closed issue means its agreed goal has been completed. It does not prove a production deployment. For a regression, provide a new reproducible report that links to the earlier issue.
