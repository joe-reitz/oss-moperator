# Connect Luma

Luma (lu.ma) hosts event registration pages. With this connected, the agent can
create them — with your compliance questions already attached, which is the part
that otherwise gets forgotten.

## 1. Get the API key

Luma's public API requires a Luma Plus subscription.

1. Open your calendar at [lu.ma](https://lu.ma).
2. Go to **Settings → Options → API** (or **Calendar Settings → API keys**).
3. Create a key and copy it.

```bash
LUMA_API_KEY=secret-...
```

One key, one calendar. If you run several calendars, pick the one the agent should
create events on.

## 2. Optional settings

```bash
# Default cover image. Without it, the agent falls back to your calendar's
# avatar or cover image.
LUMA_DEFAULT_COVER_URL=https://...

# The Salesforce Campaign field that stores the created Luma event id, so
# attribution has a join key. Create it as a Text(255) field first.
SFDC_CAMPAIGN_LUMA_EVENT_FIELD=Luma_Event_Id__c
```

## 3. Set your compliance questions

This is the reason to use the agent for this rather than the Luma UI. Every event
it creates gets the same registration questions attached automatically, so nobody
ships a page missing the marketing opt-in.

They are defined in `agent/lib/luma/client.ts`:

```ts
export const COMPLIANCE_REGISTRATION_QUESTIONS: RegistrationQuestion[] = [
  { id: "company", label: "Company", required: true, question_type: "company",
    collect_job_title: true },
  { id: "country", label: "Country", required: true, question_type: "dropdown",
    options: [/* ... */] },
  { id: "marketing_opt_in", required: false, question_type: "agree-check",
    label: "I agree to receive marketing communications. You can unsubscribe at any time." },
]
```

Edit these to match what your legal and marketing teams require. The shape mirrors
Luma's public API, so you can add any question type it supports.

There is also a separate data-sharing opt-in, `PARTNER_DATA_SHARING_QUESTION`,
added only when an event has external co-organizers. The agent detects those from
the event title and description — "co-hosted with Acme", "presented by Acme" — and
adds the checkbox, because sharing registrant data with a sponsor generally
requires consent. Review that wording with whoever owns privacy at your company.

## 4. Try it

```bash
npm run agent
```

> Create a Luma event for our observability launch dinner in Austin on March 12
> from 6pm to 9pm, co-hosted with Acme

The agent will infer `America/Chicago` from Austin, derive the duration, put Acme
in `partners` so the data-sharing checkbox is added, and then pause for approval
showing you every field before anything is published.

Approve it and you get back the public URL, the manage URL, and confirmation of
whether the Salesforce campaign was stamped.

## What it can do

| Tool | Notes |
| --- | --- |
| `create_luma_event` | Private by default, registration approval on by default. Requires human approval. |
| `update_luma_event_visibility` | Public or private. Requires approval — making an event public exposes the page. |
| `add_luma_event_host` | Grant someone management access. Requires approval. |

All three are gated because they are outward-facing and awkward to undo.

## Things to know

**Times are local wall-clock plus a timezone.** The agent passes
`2026-03-15T18:00:00` with `America/Chicago` and the client converts. Do not ask it
to "use UTC" — that is how an event ends up three hours off.

**Events are private unless you ask for public.** Private means link-only, not
hidden from registrants.

**Location or meeting URL.** A physical event needs address and city, a virtual one
needs the meeting URL. Addresses are geocoded so the map on the page works.

**Your own company is not a co-organizer.** Set `MOPERATOR_ORG_NAME` and the agent
knows to leave it out of `partners`.

## Troubleshooting

- **"Luma API error (401)"** — the key is wrong, or your calendar does not have
  Luma Plus.
- **The event was created but the campaign was not stamped** — the agent reports
  this rather than failing. Check `SFDC_CAMPAIGN_LUMA_EVENT_FIELD` exists on
  Campaign and the service account can write it.
- **Registration approval is off when you expected it on** — it defaults to on;
  it only goes off if someone explicitly asked for open registration. Check what
  the approval prompt showed.
