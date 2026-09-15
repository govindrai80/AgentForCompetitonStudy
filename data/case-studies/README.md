This directory holds one markdown file per engagement.

YAML frontmatter is the structured record the matcher reads; the body below the
frontmatter is the narrative the selector reads when deciding relevance.

Fields, in full:

  id                 defaults to the filename
  client             the real client name, always — confidentiality governs use
  confidentiality    public | anonymized | internal_only
  anonymousLabel     required when confidentiality is "anonymized"
  industry           free text; matched loosely against researched industry
  subSectors         list
  country / region   used for locale and regional matching
  companySize        free text, e.g. "300 employees"
  businessModel      free text, e.g. "B2B SaaS, per-seat"
  problem            one or two sentences
  solution           one or two sentences
  servicesUsed       list of service ids from config/company.yaml — validated
  stack              list; matched against the prospect's observed tech signals
  results            list of { metric, before, after, delta, timeframe, verified }
  quote              { text, attribution } — only used when confidentiality is public
  engagementLength   free text
  year               integer
  tags               list

On `verified`: set it true only when you could show the number to the client
and they would agree with it. Unverified numbers are never quoted in an email —
the deterministic gate blocks them — but they still inform the selector.
