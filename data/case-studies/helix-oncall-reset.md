---
id: helix-oncall-reset
client: Helix Diagnostics
confidentiality: internal_only
industry: Healthcare
subSectors: [diagnostics, B2B SaaS]
country: United States
region: North America
companySize: 400 employees
businessModel: B2B SaaS with per-test pricing
problem: >-
  On-call engineers were receiving 340 pages a month, of which fewer than 5%
  corresponded to user-visible impact. Two senior engineers had resigned citing
  on-call load.
solution: >-
  Deleted or downgraded 80% of alerts, rebuilt the remainder around four
  user-visible SLOs, and restructured the rotation with a formal handover.
servicesUsed: [reliability]
stack: [Python, Django, PostgreSQL, Datadog, AWS]
results:
  - metric: Monthly page volume
    before: "340"
    after: "48"
    delta: "-86% monthly pages"
    timeframe: 10 weeks
    verified: true
  - metric: Median incident acknowledgement time
    before: 14 minutes
    after: 3 minutes
    delta: "-79% time to acknowledge"
    verified: true
engagementLength: 10 weeks
year: 2025
tags: [sre, oncall, slo, alert-fatigue]
---

Marked internal_only: the client has not agreed to any external use of this
engagement, named or anonymised, because the attrition detail is identifying in
a small market.

It stays in the library because it is useful context for the sales team and for
the selector's understanding of what we do — but the pipeline filters it out
before any stage that could quote it, and the deterministic gate blocks the
client name from appearing in outbound copy even if a model tried.
