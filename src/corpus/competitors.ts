import type { Corpus } from "./load.js";
import { matchCompany, type MatchConfidence, type NameMatch } from "../util/names.js";
import type { CaseStudy, ClientRecord, ProspectResearch } from "../types.js";

/**
 * Cross-references the prospect's competitors against our own client base.
 *
 * For an agency this is the strongest thing in the email — "we ran this for the
 * developer you compete with" outranks any generic capability claim. It is also
 * the thing most likely to cause a problem, because the rival in question may
 * have a view about it, and so may the prospect. So the same pass produces both
 * the leverage and the caution, and neither is decided automatically.
 */

export interface CompetitorLeverage {
  competitor: string;
  relationship: "direct" | "adjacent" | "aspirational";
  match: NameMatch;
  /** Where the relationship is recorded. */
  origin: { kind: "case-study"; id: string; client: string } | { kind: "client-list"; name: string };
  /** May this be referred to in outbound copy at all? */
  usable: boolean;
  /** Exactly how to refer to them if usable. */
  referAs: string;
  /** The brand in the group that holds this relationship. */
  heldBy: string;
  /** True when a sibling brand holds it, not the one sending this email. */
  sibling: boolean;
  note: string;
}

export interface CompetitorCaution {
  competitor: string;
  ourClient: string;
  severity: "major" | "minor";
  reason: string;
}

export interface CompetitorIntel {
  /** Exact or strong name matches we are allowed to reference. */
  leverage: CompetitorLeverage[];
  /** Exact or strong matches we may not name. Useful to us, invisible to them. */
  silent: CompetitorLeverage[];
  /** Weak matches — reported for a human to confirm or dismiss. Never used. */
  possible: CompetitorLeverage[];
  cautions: CompetitorCaution[];
  /** Competitors we have no recorded relationship with. */
  unmatched: string[];
}

export function analyseCompetitors(corpus: Corpus, research: ProspectResearch): CompetitorIntel {
  const intel: CompetitorIntel = { leverage: [], silent: [], possible: [], cautions: [], unmatched: [] };

  // Does the seller consider competitor overlap a problem? Keyed to what they
  // actually wrote in disqualifiers, not to an assumption on our part.
  const sellerMindsConflicts = corpus.company.disqualifiers.some((d) =>
    /competitor|conflict|exclusiv/i.test(d),
  );

  for (const competitor of research.competitors) {
    const hits = findRelationships(corpus, competitor.name);
    if (hits.length === 0) {
      intel.unmatched.push(competitor.name);
      continue;
    }

    for (const hit of hits) {
      const entry: CompetitorLeverage = {
        competitor: competitor.name,
        relationship: competitor.relationship,
        match: hit.match,
        origin: hit.origin,
        usable: hit.usable,
        referAs: hit.referAs,
        heldBy: hit.heldBy,
        sibling: hit.heldBy !== corpus.brand,
        note: hit.note,
      };

      if (hit.match.confidence === "weak") {
        intel.possible.push(entry);
        continue;
      }
      (hit.usable ? intel.leverage : intel.silent).push(entry);

      if (competitor.relationship === "direct") {
        intel.cautions.push({
          competitor: competitor.name,
          ourClient: hit.clientName,
          severity: sellerMindsConflicts ? "major" : "minor",
          reason: hit.heldBy !== corpus.brand
            ? `${hit.clientName} is a direct competitor of the prospect and is already a client of ${hit.heldBy}, a sibling brand. Check across the group before ${corpus.brand} approaches this prospect — the conflict is the group's, not just this brand's.`
            : sellerMindsConflicts
              ? `${hit.clientName} is already a client and is a direct competitor of the prospect. Your own disqualifiers flag this — confirm there is no exclusivity commitment before sending.`
              : `${hit.clientName} is already a client and is a direct competitor of the prospect. Strong leverage, but confirm both sides are comfortable with it.`,
        });
      }
    }
  }

  return intel;
}

interface Relationship {
  match: NameMatch;
  origin: CompetitorLeverage["origin"];
  clientName: string;
  usable: boolean;
  referAs: string;
  heldBy: string;
  note: string;
}

/**
 * Searches the *entire* corpus, internal_only case studies included. Those can
 * never be quoted, but a competitor being an internal_only client is exactly
 * the kind of thing a rep needs to know before they hit send.
 */
function findRelationships(corpus: Corpus, competitorName: string): Relationship[] {
  const groupBrand = corpus.brand;
  const found: Relationship[] = [];
  const claimed = new Set<string>();

  for (const cs of corpus.caseStudies) {
    const match = matchCompany(competitorName, cs.client);
    if (!match) continue;
    claimed.add(normaliseKey(cs.client));
    found.push(caseStudyRelationship(cs, match, groupBrand));
  }

  for (const client of corpus.clients) {
    // A client already covered by a case study is the richer record; skip it.
    if (claimed.has(normaliseKey(client.name))) continue;
    const match = matchCompany(competitorName, client.name);
    if (!match) continue;
    found.push(clientRelationship(client, match, groupBrand));
  }

  return found;
}

function caseStudyRelationship(cs: CaseStudy, match: NameMatch, activeBrand: string): Relationship {
  const heldBy = cs.brand ?? activeBrand;
  const base = {
    match,
    clientName: cs.client,
    heldBy,
    origin: { kind: "case-study" as const, id: cs.id, client: cs.client },
  };

  // A sibling brand's client is real knowledge and not this brand's to claim.
  if (heldBy !== activeBrand) {
    return {
      ...base,
      usable: false,
      referAs: "",
      note: `${cs.client} is a client of ${heldBy}, a sibling brand — not of ${activeBrand}. Useful context; not this brand's proof to cite. Route the introduction through ${heldBy} if you want to use it.`,
    };
  }

  if (cs.confidentiality === "public") {
    return {
      ...base,
      usable: true,
      referAs: cs.client,
      note: `Worked with ${cs.client} (case study "${cs.id}"). Nameable, with quotable results.`,
    };
  }
  if (cs.confidentiality === "anonymized") {
    return {
      ...base,
      usable: true,
      referAs: cs.anonymousLabel ?? `a ${cs.industry} company in ${cs.country}`,
      note: `Worked with this competitor, but the engagement is anonymised — refer to them only as "${cs.anonymousLabel}".`,
    };
  }
  return {
    ...base,
    usable: false,
    referAs: "",
    note: `Worked with ${cs.client}, but the engagement is internal_only and cannot be referenced in any form.`,
  };
}

function clientRelationship(client: ClientRecord, match: NameMatch, activeBrand: string): Relationship {
  const heldBy = client.brand ?? activeBrand;
  const base = {
    match,
    clientName: client.name,
    heldBy,
    origin: { kind: "client-list" as const, name: client.name },
  };
  if (heldBy !== activeBrand) {
    return {
      ...base,
      usable: false,
      referAs: "",
      note: `${client.name} is a client of ${heldBy}, a sibling brand — not of ${activeBrand}. Useful context; not this brand's proof to cite.`,
    };
  }
  return client.nameable
    ? {
        ...base,
        usable: true,
        referAs: client.name,
        note: `${client.name} is on the client list and is cleared to be named, but has no case study — so there are no numbers to cite, only the relationship.`,
      }
    : {
        ...base,
        usable: false,
        referAs: "",
        note: `${client.name} is on the client list but is not cleared to be named.`,
      };
}

const normaliseKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Case-study ids whose client is a confirmed competitor — used to bias the shortlist. */
export const competitorCaseStudyIds = (intel: CompetitorIntel): Set<string> =>
  new Set(
    [...intel.leverage, ...intel.silent]
      .filter((l) => l.origin.kind === "case-study")
      .map((l) => (l.origin as { id: string }).id),
  );

export interface CrossBrandClient {
  /** How the client is written by the first brand that recorded it. */
  name: string;
  brands: string[];
  confidence: MatchConfidence;
  aliases: string[];
}

/**
 * Clients recorded under more than one brand in the group.
 *
 * Worth knowing before a campaign: where two brands sell overlapping services
 * to the same account, they can end up pitching the same prospect in the same
 * week, and a conflict one brand clears is not automatically cleared for
 * another. Name matching is fuzzy, so weak matches are reported as such rather
 * than asserted.
 */
export function findCrossBrandClients(clients: ClientRecord[]): CrossBrandClient[] {
  const groups: { names: string[]; brands: Set<string>; confidence: MatchConfidence }[] = [];

  for (const client of clients) {
    const brand = client.brand ?? "(unassigned)";
    const existing = groups.find((g) => g.names.some((n) => matchCompany(n, client.name)));

    if (!existing) {
      groups.push({ names: [client.name], brands: new Set([brand]), confidence: "exact" });
      continue;
    }
    const match = existing.names.map((n) => matchCompany(n, client.name)).find(Boolean)!;
    // A group is only as certain as its loosest link.
    if (match.confidence === "weak") existing.confidence = "weak";
    else if (match.confidence === "strong" && existing.confidence === "exact") existing.confidence = "strong";
    if (!existing.names.includes(client.name)) existing.names.push(client.name);
    existing.brands.add(brand);
  }

  return groups
    .filter((g) => g.brands.size > 1)
    .map((g) => ({
      name: g.names[0]!,
      brands: [...g.brands].sort(),
      confidence: g.confidence,
      aliases: g.names.slice(1),
    }))
    .sort((a, b) => b.brands.length - a.brands.length || a.name.localeCompare(b.name));
}
