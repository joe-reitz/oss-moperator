---
description: Use when setting up an event — a webinar, dinner, conference presence, or meetup — including the Luma registration page, its compliance questions, and the Salesforce campaign behind it.
---

# Setting up an event

## Salesforce first, Luma second

Create the Salesforce campaign before the registration page, so the event page
can carry the campaign ID and registrations have somewhere to land. Event
campaigns usually want Type set to the event kind (Webinar, Conference,
Other) and realistic Start/End dates.

## Getting the Luma details right

**Times are local wall-clock plus a timezone.** Pass `2026-03-15T18:00:00` with
`America/Chicago`, not a UTC conversion. Converting yourself is how an event
ends up three hours off.

**Infer the timezone from the city** and say which one you used, so a mistake is
visible before the page is published.

**Location or meeting URL, not both.** A physical event needs address, city,
region, country. A virtual one needs the meeting URL. A hybrid needs a decision
about which one the page leads with.

**Compliance questions are automatic.** Company with job title, country, and
marketing opt-in are attached to every event by the tool. Do not add them, and
do not offer to remove them.

**Co-organizers change the form.** Any external org co-hosting or sponsoring
goes in `partners`, which adds a data-sharing opt-in that Legal requires before
registrant data can be shared. Scan the title and description for "with X",
"co-hosted with X", "presented by X", "X is sponsoring". Venues, caterers, and
AV vendors are not co-organizers. Do not include your own company.

**Private by default.** Events are link-only unless someone explicitly asks for
public. Registration approval defaults to on. Both are separately changeable
afterward, and both changes are gated.

## Before you publish

Publishing is outward-facing and gated on approval, so state the full picture in
your message: name, local date and time with timezone, location or link,
visibility, whether registration needs approval, and who the co-organizers are.
The approval prompt shows the same fields — they should match what you said.

After creation, report the public URL, the manage URL, and whether the
Salesforce campaign was successfully stamped. If the campaign link failed, say
so; the event still exists and someone needs to fix the join.
