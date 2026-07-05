# BD Lead Engine — Production Lead Sourcing & Enrichment Playbook

This playbook defines the production rules for finding, qualifying and enriching high-quality BD leads without polluting a lead with unrelated contact links.

## Objective

Maximize qualified, contactable forex/CFD partner leads while keeping every contact path attributable, auditable and safe for manual outbound.

The engine should optimize for:

- High-intent partner, IB, affiliate, signal provider, money manager, trading educator and community leads.
- Real communication paths: WhatsApp, email, phone, contact forms, booking links and owned social profiles.
- Low contamination: no random broker links, review sites, unrelated contact forms, media files, generic social pages or public-search noise.
- Clear provenance: every enriched contact must be traceable back to the source profile, a website/linkhub discovered from that profile, or a strictly identity-matched public-search trail.

## Production waterfall

1. **Source discovery**
   - Use segmented query packs: partner, social, intent, specialist, forum, ecosystem and recruitment.
   - Prefer source diversity over repeated low-quality MQL5/social scraping.
   - Use source caps and dedupe before enrichment.

2. **Initial qualification**
   - Keep only records with searchable trading/partner intent.
   - Hard-reject broker official domains, referral URLs, broker review pages, content farms, generic article pages and unrelated CFD noise.
   - Classify lead type and ICP before spending deep enrichment time.

3. **Profile-first enrichment**
   - Read the source profile/page first.
   - Extract direct links, website links, linkhub links, emails, phones, forms and WhatsApp links from the source context.
   - Crawl only websites/linkhubs discovered from the profile/page itself.

4. **Website/contact-page crawl**
   - Crawl the homepage plus likely contact/about/partnership/affiliate paths.
   - Keep only contact-intent forms and communication links.
   - Normalize WhatsApp links into `https://wa.me/<digits>` where possible.

5. **Strict search-trail enrichment**
   - Run public-search contact trail only when the lead still has no actionable contact.
   - Accept a search-trail result only if it matches lead identity by strong alias, URL identity or multiple non-generic tokens plus trading/contact context.
   - Do not use broad public-search results as website candidates unless the identity gate passes.
   - Cap crawled trail pages to avoid contamination.

6. **Best-contact selection**
   - Rank by direct communication utility and attribution.
   - Store `contactConfidence`, `contactQuality`, `bestContact`, `bestContactType`, `bestContactSource` and `enrichmentAudit`.

7. **Export and manual outbound**
   - Export only qualified/contactable leads by default.
   - Keep raw mode available for diagnostics, not for outreach.
   - Outbound remains manual; no login scraping or automated messaging.

## Contact confidence model

| Contact quality | Confidence | Meaning |
| --- | ---: | --- |
| WhatsApp | 96 | Direct communication path discovered and normalized. |
| Email | 94 | Clean non-blocked email discovered. |
| Phone | 90 | International-format phone discovered. |
| Form | 86 | Contact/partner/message form found. |
| Direct link | 82 | Booking, Telegram or similar direct path. |
| Social | 74 | Useful owned/profile social URL. |
| Contact page | 65 | Contact-intent page but no direct path yet. |
| Website | 45 | Website found but no direct path yet. |
| No contact yet | 15 | Lead needs further research. |

## Anti-contamination rules

- Never crawl `relatedLinks` as candidate websites by default.
- Never merge forms from a public-search hit unless the hit passes the identity gate.
- Do not continue broad contact search when the source profile already produced WhatsApp, email, phone, direct link or a valid form.
- Treat search-trail pages as evidence first, contact sources second.
- Keep broker/referral domains blocked unless explicitly required for diagnostics.
- Keep public platform URLs legal and public-only: no logged-in scraping, no private data extraction, no auto-DM.

## Optional paid enrichment layer

A paid enrichment provider should be used as a final waterfall step, not as the first source of truth.

Recommended matching keys:

- Domain / website
- LinkedIn company or person URL
- Company/person name
- Location / country
- Role/title keywords

Use asynchronous webhook/idempotency when waterfalling email/phone enrichment. Store provider, match confidence and timestamp separately so paid data can be audited and refreshed.

Reference docs reviewed while defining this playbook:

- Apollo Organization Search API: https://docs.apollo.io/reference/organization-search
- Apollo Organization Enrichment API: https://docs.apollo.io/reference/organization-enrichment
- Apollo People Enrichment API: https://docs.apollo.io/reference/people-enrichment
- HubSpot lead scoring guidance: https://www.hubspot.com/products/marketing/lead-scoring
- FTC CAN-SPAM business guidance: https://www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business

## QA checklist before outreach

For each export batch, inspect:

- Raw leads vs qualified leads.
- Qualified leads by source bucket.
- Contactable percentage.
- A1/A2 tier percentage.
- Duplicate rate by domain/profile.
- Leads with `searchTrailUsed=true` and low contact confidence.
- Leads whose `bestContactSource` is not source profile / source-discovered website / source-discovered linkhub.
- Forms from unrelated domains.
- Broker/referral URLs leaking into contact links.

## Myfxbook regression expectation

For a Myfxbook profile such as `myfxbook.com/members/<user>/<system>/<id>`:

1. Read the Myfxbook page first.
2. Extract any website listed on the profile.
3. Crawl the listed website and likely contact/about pages.
4. Extract WhatsApp/email/phone/forms from that website.
5. Stop broad search-trail enrichment once a valid WhatsApp/email/phone/form is found.
6. Keep unrelated public-search pages out of the lead's contact links and forms.
