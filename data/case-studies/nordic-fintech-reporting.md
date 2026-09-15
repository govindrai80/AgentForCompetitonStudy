---
id: nordic-fintech-reporting
client: Lindqvist Betalningar AB
confidentiality: anonymized
anonymousLabel: a Nordic payments company
industry: Fintech
subSectors: [payments, B2B SaaS]
country: Sweden
region: Europe
companySize: 260 employees
businessModel: B2B SaaS, transaction-volume pricing
problem: >-
  Regulatory and customer-facing reporting ran against the production Postgres
  primary. Month-end reporting load caused payment authorisation latency to
  spike, which put a contractual SLA at risk.
solution: >-
  Moved reporting to a ClickHouse read path fed by Debezium CDC, in four
  independently revertible phases, with EU-only data residency maintained
  throughout and an auditable lineage for every reported figure.
servicesUsed: [data-platform, platform-perf]
stack: [Go, PostgreSQL, Debezium, Kafka, ClickHouse, GCP]
results:
  - metric: Month-end authorisation p99 latency
    before: 1.8s
    after: 240ms
    delta: "-87% month-end p99 authorisation latency"
    timeframe: 18 weeks
    verified: true
  - metric: Regulatory report generation time
    before: 6 hours
    after: 11 minutes
    delta: "6 hours to 11 minutes"
    timeframe: 18 weeks
    verified: true
  - metric: Production database CPU at month-end
    delta: "roughly halved"
    verified: false
engagementLength: 18 weeks
year: 2025
tags: [cdc, clickhouse, gdpr, data-residency, reporting]
---

The client's reporting had grown organically against the transactional primary.
Every month-end, a set of long-running analytical queries competed with payment
authorisation, and authorisation p99 crossed the threshold written into two
enterprise contracts.

They had attempted a warehouse migration eighteen months earlier and abandoned it
partway, which left them sceptical of anything described as a migration. We
structured the work as four phases, each shippable and each revertible on its own:
CDC pipeline standing up alongside the existing path; one report cut over; the
remaining customer-facing reports; then the regulatory set, which required a
documented lineage from every figure back to the source transaction.

Data residency was a hard constraint — EU only, with the ClickHouse cluster and
every Kafka broker in-region, evidenced for their auditor. We did not need to
dual-write, which was the design decision that had killed the previous attempt.

The client's name is under NDA. The results above are cleared for use in an
anonymised form.
