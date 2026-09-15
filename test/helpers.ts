import { loadAgentConfig } from "../src/config.js";
import { loadCorpus } from "../src/corpus/load.js";
import type { ProspectResearch } from "../src/types.js";

/** The suite runs against a fixture corpus, never the sales team's live data. */
export const FIXTURE_CONFIG = "test/fixtures/config/agent.yaml";
export const fixtureConfig = (brand?: string) => loadAgentConfig(FIXTURE_CONFIG, brand);
export const fixtureCorpus = (brand?: string) => loadCorpus(fixtureConfig(brand));

type Competitor = ProspectResearch["competitors"][number];

export const competitor = (
  name: string,
  relationship: Competitor["relationship"] = "direct",
): Competitor => ({ name, relationship, basis: "same micro-market", sourceIds: ["s1"] });

export const research = (over: Partial<ProspectResearch> = {}): ProspectResearch => ({
  company: {
    displayName: "Northpoint Developers",
    legalName: "Northpoint Developers Pvt Ltd",
    website: "https://northpoint.example",
    hqCountry: "India",
    hqCity: "Mumbai",
    foundedYear: 2009,
    employeeRange: "200-500",
    ownership: "Private",
    fundingStage: null,
  },
  industry: { primary: "Real Estate", subSectors: ["residential", "mid-income"], businessModel: "Residential developer" },
  market: { countriesServed: ["India"], primaryRegion: "India", languages: ["English", "Hindi"] },
  productsAndServices: ["residential towers"],
  techSignals: ["Salesforce"],
  recentDevelopments: [
    { headline: "Launched a 600-unit tower in Thane", date: "2026-06", whyItMatters: "Absorption pressure", sourceIds: ["s1"] },
  ],
  likelyPains: [{ pain: "inventory ageing on tower B", evidence: "MahaRERA filing", sourceIds: ["s2"] }],
  buyingContext: { likelyBuyerTitles: ["Head of Sales"], probableTriggers: ["launch"], procurementNotes: null },
  competitors: [],
  regionalNotes: [],
  regulatoryNotes: [],
  confidence: "high",
  gaps: [],
  sources: [
    { id: "s1", url: "https://trade.example/a", title: "Thane launch", publisher: "Trade Press", publishedDate: "2026-06-01" },
    { id: "s2", url: "https://maharera.example/x", title: "MahaRERA filing", publisher: null, publishedDate: null },
  ],
  ...over,
});
