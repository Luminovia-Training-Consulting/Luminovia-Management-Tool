# Creating and handling useful issues

A useful issue describes a reproducible problem or a verifiable goal. Start from the [GitHub issue chooser](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/issues/new/choose). German and English reports are welcome; project documentation is maintained in English. [CONTRIBUTING](../CONTRIBUTING.md) explains the overall workflow.

## Before opening an issue

Search open and closed issues and active pull requests. Check the [implementation plan](IMPLEMENTATION_PLAN.md) and [roadmap](../ROADMAP.md) when a feature appears missing. A pending feature can be clarified as a proposal; it is not an already delivered, broken workflow.

Keep one coherent problem per issue. Report unrelated defects separately so reproduction, validation and closure stay unambiguous.

## Reporting a bug

Use the bug form and include:

- A short, concrete title, such as “File list omits replaced version after reopening”.
- The commit or development release, browser/operating system and affected fictional account role.
- The smallest reproducible sequence using fictional data.
- Expected and observed behaviour, including the exact error message.
- Impact and frequency; for scheduling problems, include the date, time and IANA time zone.
- Sanitised screenshots or relevant log lines where useful.

For startup failures, include the command, Node/Docker versions and visible error. The [local guide](LOCAL_DEVELOPMENT.md) explains services, ports and persistence. Do not delete needed volumes or reset an ordinary database to reproduce a problem.

Remove tokens, passwords, Auth callback URLs, QR codes, personal data and private document content from attachments. Never upload raw `.local` directories, Playwright traces, HAR files or database backups. Network captures can contain sessions and private responses even when they appear harmless.

## Proposing features and improvements

Explain who has the problem and what is currently missing. Describe the desired workflow and verifiable acceptance criteria. Identify affected roles, views and permissions, and possible effects on existing data.

For example: “After a course assignment is revoked, the existing lecturer account can no longer download the associated private files, even with its unchanged session.” A statement such as “secure and user-friendly” alone cannot be verified.

Technical proposals are welcome. Substantial schema changes, additional services and changes to accepted commercial terms need reasoned agreement before implementation.

## Questions and documentation gaps

Use the question or feature form for documentation improvements. Link the specific page and explain which information is absent or contradictory. Code questions should include a small sanitised reference and the intended result.

## Reporting security issues

Do not publish suspected vulnerabilities, exploit steps, stolen data or credentials in a public issue or PR. This applies especially to permission bypasses, private files, sessions and financial information.

GitHub private vulnerability reporting is enabled for this repository. Use [Report a vulnerability](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/security/advisories/new) in the Security area to send details confidentially to the maintainers. If the form is unavailable, use an already agreed private contact route to `CarinaSchoppe`; do not publish technical details in an issue as a fallback.

Include the affected commit, minimal reproduction with fictional data, expected permission boundary and impact. Do not access additional real accounts or data to expand the finding.

## Triage and labels

Maintainers review reports, request clarification where needed and apply labels. Existing labels such as `bug`, `documentation`, `question`, `duplicate`, `good first issue` and `help wanted` remain available. Related PRs must also have the [type, area and risk labels](PULL_REQUEST_GUIDE.md#labels-for-pull-requests).

You do not need label permissions to open an issue. State the likely area in its text. Use `good first issue` and `help wanted` to find suitable work; a label does not guarantee scope or review time.

## From report to correction

1. Reproduce the problem and agree on the intended behaviour.
2. Assign the work and link the issue from the pull request.
3. Add appropriate validation and update affected documentation.
4. Merge after the intended checks and review. `Closes #123` closes the linked issue automatically. The [PR guide](PULL_REQUEST_GUIDE.md) distinguishes process expectations from current ruleset enforcement and maintainer bypass.

A closed issue means its agreed goal is complete, not that production installation occurred. For a regression, open a new reproducible report referring to the earlier issue.
