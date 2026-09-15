import type { CompanyProfile, EmailDraft, LocaleProfile } from "../types.js";

/**
 * The model writes the body only. The signature and the legal footer are
 * assembled here from configuration, so they are identical on every email and
 * cannot be paraphrased, abbreviated, or dropped by a model having an off day.
 */
export function renderEmailBody(
  draft: EmailDraft,
  company: CompanyProfile,
  locale: LocaleProfile,
): string {
  const s = company.sender;
  const signature = [
    s.name,
    `${s.title}, ${company.name}`,
    s.phone,
    company.website,
    s.calendarLink,
  ]
    .filter(Boolean)
    .join("\n");

  const footerBits: string[] = [];
  if (locale.compliance.some((c) => /address/i.test(c)) && company.postalAddress) {
    footerBits.push(company.postalAddress);
  }
  if (locale.compliance.some((c) => /opt.?out|unsubscribe/i.test(c)) && company.unsubscribeLine) {
    footerBits.push(company.unsubscribeLine);
  }

  return [
    draft.body.trim(),
    "",
    "--",
    signature,
    ...(footerBits.length ? ["", footerBits.join("\n")] : []),
  ].join("\n");
}
