# 0003 — Source-bound validation and release evidence

Status: existing quality contract, restated on 16 November 2026.

A successful check supports the tested revision, environment and behaviour. It does not establish the absence of every possible bug. Record actual command exits, test counts, failures, fixes and untested paths in [QA_RESULTS](../QA_RESULTS.md) and [functional acceptance matrix](../FUNCTIONAL_ACCEPTANCE.md).

Develop and test locally by default. Use focused checks during development and the isolated `./portal test` command for application acceptance. The actual selfhost image/retained-data gate remains separate, alongside required GitHub merge checks. A test or successful merge does not authorise deployment or release publication. Tests use fictional records and disposable owned resources, preserving persistent development and hosted data.

Consequences: distinguish scanner completion from finding closure, unit coverage from backend/browser coverage, an accepted development milestone from production approval, and browser emulation from physical installation. Keep failed runs visible; fix demonstrated defects and rerun affected checks rather than weakening assertions. [TEST_PLAN](../TEST_PLAN.md) and [CI_QUALITY](../CI_QUALITY.md) define the concrete workflow.
