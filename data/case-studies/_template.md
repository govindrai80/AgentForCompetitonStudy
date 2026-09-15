---
# Copy this file, rename it, and fill it in. Files starting with "_" are ignored
# by the loader, so this one never enters the library.
#
# Run `npm run outreach -- validate` after each new case study. It checks the
# service ids resolve and tells you how much of your evidence is unverified.
id: your-case-study-id
# Which brand ran this. Omit to let any brand cite it. A sibling brand's work
# stays visible to the competitor scan but never enters another brand's pitch.
brand: insomniacs
client: Full legal or trading name of the client
# public         → nameable, verified numbers quotable, testimonial usable
# anonymized     → numbers quotable, client described only by anonymousLabel
# internal_only  → reference material only; never appears in outbound copy
confidentiality: anonymized
anonymousLabel: a Bengaluru developer with a mid-income portfolio
industry: Real Estate
subSectors: [residential, luxury, plotted development, commercial]
country: India
region: India
companySize: e.g. 12 live projects across 3 cities
businessModel: e.g. Residential developer, mid-income, Bengaluru and Hyderabad
problem: >-
  One or two sentences. The situation as the client experienced it, in their
  language — not the service you sold.
solution: >-
  One or two sentences. What was actually done. Specific enough that a peer
  would recognise it as real work.
servicesUsed: [performance-marketing, crm-leads]
stack: [Lead Matrix, iREPS]
engagementLength: e.g. 9 months
year: 2025

results:
  # verified: true means you could put this number in front of the client and
  # they would agree with it. Anything else stays false and is never quoted.
  - metric: Cost per booking
    before: "₹X.X lakh"
    after: "₹X.X lakh"
    delta: "-XX% cost per booking"
    timeframe: 6 months
    verified: true
  - metric: Enquiry to site visit conversion
    before: "X%"
    after: "X%"
    delta: "+X pts enquiry-to-site-visit"
    verified: false

# Only used when confidentiality is "public".
# quote:
#   text: Something the client actually said.
#   attribution: Title, Company

tags: [launch, absorption, nri, regional-creative]
---

The narrative. This is what the selection stage reads when judging whether this
engagement is genuinely comparable to a prospect's situation — so write it for a
colleague, not for a brochure. What was actually going wrong, what you tried,
what did not work, and what the constraint was.

Detail here is what separates a sharp email from a generic one.
