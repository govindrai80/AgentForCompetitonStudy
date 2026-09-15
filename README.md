# Outreach Agent

Give it a prospect company name. It researches them on the live web, works out
which of your past engagements are genuinely comparable, and writes a first-contact
email calibrated to their industry and their market — with every factual claim
traced back to a source you can open.

```bash
npm install
cp .env.example .env          # add ANTHROPIC_API_KEY
npm run outreach -- validate  # check your reference material loads
npm run outreach -- research "Acme Logistics" --contact "Dana Whitfield" --title "VP Engineering"
```

Output lands in `out/<prospect>-<timestamp>/`:

| File | What it is |
| --- | --- |
| `email.txt` | The draft, signature and legal footer included. Ready to paste. |
| `brief.md` | The research, the reasoning, the claim ledger, and both audit results. Read this before you send. |
| `run.json` | Every structured artifact plus token usage. For your CRM, or for arguing with later. |

---

## The design question that matters

An agent that writes sales emails from web research will, sooner or later,
attribute a result to a client who never agreed to be named, or quote a number
nobody verified. That is not a quality problem you fix with a better prompt. It
is a legal and reputational problem, and it is invisible — the email reads
beautifully either way.

So the pipeline is built around a closed evidence world:

1. **Research** runs with web search and web fetch, and produces prose with
   inline source attribution.
2. **Structure** converts that prose to a schema where every claim about the
   prospect carries the id of the source that established it.
3. **Select** ranks your case studies against the research. A deterministic
   prefilter narrows the library first, so this stays cheap as it grows.
4. **Build the evidence pack** — in code, not in a model. This is the complete
   set of facts the writer is permitted to use. Internal-only case studies are
   dropped here. Anonymised clients are replaced with their cleared label.
   Unverified numbers are marked unquotable.
5. **Draft** sees the evidence pack and nothing else, and must return a ledger
   mapping every claim in the body to a ref in the pack.
6. **Check**, twice and independently:
   - a **deterministic gate** — string matching and arithmetic, so it cannot be
     talked out of anything;
   - a **grounding audit** by a separate model call that is given the email and
     the evidence pack *only*. It has never seen the research prose, so it
     cannot be argued into accepting a claim that is not in the pack.

A blocked draft still gets written to disk with its findings, and the process
exits non-zero. Nothing is sent. Ever — see *Gmail* below.

### What the confidentiality levels do

Set per case study, in its frontmatter:

| Level | Effect |
| --- | --- |
| `public` | Client may be named. Verified numbers quotable. Testimonial usable. |
| `anonymized` | Numbers quotable; the client is referred to only by `anonymousLabel`. The real name appearing anywhere in the body is a hard block. |
| `internal_only` | Filtered out before any stage that could quote it. The name is still blocked from outbound copy as a backstop. |

Independently, a result with `verified: false` is never quoted as a number. It
still informs which case study gets selected — it just cannot become a figure in
an email.

---

## Setting it up for your business

Three files, then you're running.

**`config/company.yaml`** — who you are, what you sell, and the specifications a
technical buyer will ask about. The shipped file is a worked example for a
fictional firm called Northwind Systems; replace all of it. Two fields do real
work:

- `disqualifiers` — signals that mean you should not pitch at all. The selector
  checks the research against these and reports any that fire.
- `forbiddenClaims` — things you may not say, for legal or contractual reasons.
  Enforced by substring in the gate and in substance by the auditor.

**`data/case-studies/*.md`** — one markdown file per engagement. YAML frontmatter
is the structured record; the prose below it is what the selector reads when
judging relevance. Full field reference in `data/case-studies/README.md`.

The honest constraint: this system is exactly as good as this directory. Three
thin case studies produce three thin emails. The single highest-leverage thing
you can do after setup is go back through past engagements and record real
numbers with `verified: true`.

**`config/locales.yaml`** — tone, formality, length limits and the statutory
position per market. Edit the tone notes freely as your team learns what earns
replies. The `compliance` entries drive hard checks (postal address, opt-out
line), so treat those as load-bearing.

`config/industries.yaml` sets vocabulary and register by buyer type, and which
specs that audience actually checks first.

Run `npm run outreach -- validate` after any edit. It parses everything, checks
service ids referenced by case studies actually exist, and tells you how much of
your results library is unverified — without spending a token.

---

## Commands

```bash
# One prospect
npm run outreach -- research "Acme Logistics" \
  --contact "Dana Whitfield" --title "VP Engineering" \
  --website https://acme.example --country "United States" \
  --notes "Met at KubeCon; mentioned peak-season incidents"

# A list — see data/prospects.example.csv for the columns
npm run outreach -- batch prospects.csv --continue-on-error

# Check reference material, no API calls
npm run outreach -- validate

# What a run costs and why
npm run outreach -- estimate
```

Useful flags on `research`: `--locale DE` forces a market instead of inferring it
from the researched HQ; `--instructions "..."` passes extra guidance to the
drafting stage; `--verbose` shows the shortlist scores and stage detail.

---

## Gmail

`--gmail --to someone@example.com` additionally creates a **draft** in your
Gmail. It never sends: nothing in `src/sinks/gmail.ts` calls `messages.send`,
and a blocked draft skips Gmail entirely.

One-time setup:

1. Google Cloud Console → create or pick a project → enable the **Gmail API**.
2. **APIs & Services → OAuth consent screen** → External → add yourself as a test
   user. (Internal, if you're on Workspace.)
3. **Credentials → Create credentials → OAuth client ID → Desktop app.**
4. Put the client id and secret in `.env`.

First run with `--gmail` prints a URL. Open it, grant access, and the refresh
token is cached at `.gmail-token.json` (mode 600, gitignored). After that it is
silent.

Scope note: Gmail has no draft-only scope. `gmail.compose` is the narrowest one
that can create a draft, and it does technically also permit sending. If that
isn't a strong enough guarantee for you, skip `--gmail` and paste from
`email.txt`.

---

## Model and cost

Runs on `claude-opus-5` with adaptive thinking at `high` effort. Five calls per
prospect; the web research call dominates.

Actual token usage and an estimated dollar figure print after every run and are
stored in `run.json`. Levers, in the order worth pulling:

- **Batch.** The seller-context prefix is cached with a one-hour TTL, so every
  prospect after the first in a batch reads it at roughly a tenth of the price.
- `research.maxSearches` — the largest single input cost.
- `effort: medium` in `config/agent.yaml`.
- `model:` — anything you like, but that is a quality decision, not a free one.

Server-side refusal fallback is **on by default** (`refusalFallback` in
`config/agent.yaml`): if a request is declined on policy grounds, the API re-runs
it on a fallback model inside the same call, so one awkward prospect name doesn't
kill a batch. If your account or gateway rejects the beta, the error message says
so — set `enabled: false`.

---

## Tests

```bash
npm test        # 41 tests, no API key needed
npm run typecheck
```

The suite covers the parts where a bug is silent and expensive: the
confidentiality gate, the unverified-number check, the deterministic matcher, the
evidence pack, and a full pipeline run against a stubbed SDK client.

---

## Two things to know before you run a campaign

**Cold B2B email is not legal everywhere.** It is permitted under an opt-out
regime in the US and for corporate subscribers in the UK; it is consent-based and
strictly enforced in Germany, Canada and Japan. The `compliance` notes in
`config/locales.yaml` reflect the position at the time of writing and drive real
checks, but they are configuration, not legal advice. Have counsel look at that
file before you send into a market you haven't sold into before.

**Read the brief, not just the email.** The draft is the easy part to evaluate
and the wrong thing to evaluate. The claim ledger and the two audits are where
you find out whether the email is true.
