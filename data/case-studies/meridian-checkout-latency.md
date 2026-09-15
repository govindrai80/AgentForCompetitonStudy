---
id: meridian-checkout-latency
client: Meridian Retail Group
confidentiality: public
industry: E-commerce
subSectors: [marketplace, omnichannel retail]
country: United Kingdom
region: Europe
companySize: 800 employees
businessModel: B2C marketplace with third-party sellers
problem: >-
  Checkout p95 degraded from 900ms to 4.2s under Black Friday load two years
  running, and the team had rewritten the wrong service each time because they
  were reading averages rather than tail latency.
solution: >-
  Instrumented the full checkout path with OpenTelemetry before changing any
  code, identified a synchronous inventory call fanning out to 14 seller APIs,
  and replaced it with a cached availability projection updated by CDC.
servicesUsed: [platform-perf, data-platform]
stack: [Java, Spring Boot, PostgreSQL, Kafka, Kubernetes, AWS]
results:
  - metric: Checkout p95 latency under peak load
    before: 4.2s
    after: 610ms
    delta: "-85% p95 checkout latency"
    timeframe: 14 weeks
    verified: true
  - metric: Peak-hour checkout error rate
    before: 3.1%
    after: 0.2%
    delta: "-94% checkout errors at peak"
    timeframe: 14 weeks
    verified: true
  - metric: Annual infrastructure spend
    delta: "roughly a fifth lower"
    timeframe: 12 months
    verified: false
quote:
  text: They spent the first three weeks measuring and told us the thing we were about to rebuild was not the problem. That saved us a quarter.
  attribution: Head of Engineering, Meridian Retail Group
engagementLength: 14 weeks
year: 2024
tags: [peak-traffic, latency, observability, cdc]
---

Meridian came to us in August with a Black Friday deadline and a plan to rewrite
their order service. Two previous peak seasons had gone badly and the postmortems
both pointed at the order service, because it was where the timeouts surfaced.

We asked for three weeks to instrument before committing to any rewrite. Tracing
the full checkout path showed the order service was healthy: it was blocking on a
synchronous inventory availability call that fanned out to every third-party
seller in the basket. At median basket size this was invisible. At the 95th
percentile — larger baskets, more sellers — it was the entire latency budget.

The fix was a read-side availability projection maintained by change data capture
off the sellers' inventory updates, with a documented staleness bound the
merchandising team agreed to. The order service was not touched.

The engagement ran 14 weeks including two full-scale load tests against a
production mirror. Meridian's own engineers wrote the final projection service;
we paired on it. They ran peak that year without incident and have run the
subsequent two on their own.
