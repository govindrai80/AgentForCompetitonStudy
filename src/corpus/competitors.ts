import type { Corpus } from "./load.js";
import { matchCompany, type NameMatch } from "../util/names.js";
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
          reason: sellerMindsConflicts
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
  note: string;
}

/**
 * Searches the *entire* corpus, internal_only case studies included. Those can
 * never be quoted, but a competitor being an internal_only client is exactly
 * the kind of thing a rep needs to know before they hit send.
 */
function findRelationships(corpus: Corpus, competitorName: string): Relationship[] {
  const found: Relationship[] = [];
  const claimed = new Set<string>();

  for (const cs of corpus.caseStudies) {
    const match = matchCompany(competitorName, cs.client);
    if (!match) continue;
    claimed.add(normaliseKey(cs.client));
    found.push(caseStudyRelationship(cs, match));
  }

  for (const client of corpus.clients) {
    // A client already covered by a case study is the richer record; skip it.
    if (claimed.has(normaliseKey(client.name))) continue;
    const match = matchCompany(competitorName, client.name);
    if (!match) continue;
    found.push(clientRelationship(client, match));
  }

  return found;
}

function caseStudyRelationship(cs: CaseStudy, match: NameMatch): Relationship {
  const base = { match, clientName: cs.client, origin: { kind: "case-study" as const, id: cs.id, client: cs.client } };

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

function clientRelationship(client: ClientRecord, match: NameMatch): Relationship {
  const base = { match, clientName: client.name, origin: { kind: "client-list" as const, name: client.name } };
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
