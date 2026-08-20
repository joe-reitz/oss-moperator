# Connect Knak

[Knak](https://knak.com) is a no-code email and landing-page builder that
generates on-brand assets from your own design system and syncs them to your
marketing automation platform.

Connected here, the agent can turn an email request in Slack into a finished,
on-brand asset in about two minutes — with approved copy reproduced verbatim and
the org's naming convention applied.

## The division of labour

Worth being explicit, because it is the thing that makes this work:

**Knak writes the email.** It owns the brand design system, the themes, the
layout, and the HTML. **The agent writes the brief.** It parses the request,
resolves the brand, campaign, and theme, applies the naming convention, and
reports the result.

The agent never composes email HTML. A generic model writing email HTML produces
something off-brand that breaks in Outlook.

## 1. Get an API key

1. In Knak, go to **Settings → Integrations → API** (or ask your Knak admin —
   the API is an Enterprise feature).
2. Create a key and copy it.

```bash
KNAK_API_KEY=...
```

This is a **service credential**, so every asset the agent creates is owned by
that identity rather than by whoever last signed in. That is deliberate: assets
created by a bot should not disappear from view when an employee leaves.

Knak also exposes an MCP server behind OAuth. This integration deliberately does
not use it — the token expires and needs re-authorizing per deployment URL, and
assets end up attributed to whoever authorized it.

## 2. Point it at a default destination

Optional, but it is the difference between "build me an email" working and the
agent having to ask where to put it every time.

```bash
KNAK_DEFAULT_BRAND=Acme
KNAK_FOLDER_PATH=Campaigns/Lifecycle
```

A "campaign" in Knak's API is an **asset folder**, and folders nest. The path is
walked one segment at a time under the brand, because the brand-scoped folder
list returns only the top level — and because the id in a Knak UI URL is not the
API id, so you cannot just paste one in.

If a name does not resolve, the error lists the folders that were actually there,
which is usually enough to spot the typo.

## 3. Pick the themes

A theme is the brand design system an email is generated against. Selected by
name for the same reason as folders:

```bash
KNAK_DEFAULT_THEME_NAME=Standard Email
KNAK_NEWSLETTER_THEME_NAME=Newsletter Template
```

When a request mentions "newsletter", the newsletter theme is used; otherwise the
default. Leave both unset and Knak falls back to the brand's own default, which
is a perfectly good starting point.

Set `KNAK_DEFAULT_THEME_ID` to skip the name lookup if you already know the id.

## 4. Set the naming convention

Knak **cannot rename an asset after it is created**. Not through the API, not in
the UI. So the name is applied at generation time from a token template:

```bash
KNAK_ASSET_NAME_PATTERN={region}_{type}_{brand}_{title}_{date}_{ticket}
```

Tokens: `region`, `type` (Email → `em`, Nurture → `nur`), `brand`, `title`,
`date` (YYYYMMDD), `ticket`. Empty tokens collapse rather than leaving `__` gaps,
and spaces inside a token become hyphens, so "AI SDK Launch" stays one field.

The `ticket` token is the one people skip and later wish they hadn't — it is what
lets you trace an asset back to the request that produced it, and there is no way
to add it afterwards.

## 5. Try it

```bash
npm run agent
```

Freeform, when there is no copy yet:

> Build a Knak email announcing our new usage-based pricing page. Short, one CTA
> to acme.com/pricing.

Structured, when copy has been approved — paste the whole request:

> Build this email:
>
> Logo: Acme
> Region: NAMER
> Type: Email
> Subject Line: Introducing usage-based pricing
> Pre-header: Pay for what you use, nothing more
> Body Copy: Starting today, every Acme plan bills on actual usage...
> CTA Button Text: See the new pricing
> CTA Button Link: https://acme.com/pricing
> Target send date: 2026-09-14

The second path reproduces the copy **verbatim**. That matters more than it
sounds: a generative builder's instinct is to tighten the headline, add a
testimonial block, or fill a perceived gap with placeholder text, and all of
that is wrong once copy has been through review.

## Why the prompt looks the way it does

`agent/lib/knak/brief.ts` assembles the generation prompt deterministically, and
most of it is prohibitions. Each line is there because something went wrong
without it:

| Instruction | What it prevents |
| --- | --- |
| "do not rewrite, summarize, paraphrase" | approved copy getting "improved" |
| "include only the sections listed" | invented testimonial and speaker blocks |
| "no placeholder or lorem-ipsum text" | gaps filled with filler |
| "leave every divider as the theme defines it" | a specific recurring style drift |
| subject is "inbox subject ONLY" | the subject also rendered as an H1 in the body |
| links "must display the link text" | `[Watch the recording](url)` rendering as the bare URL |

If you fork this, treat those as load-bearing. Deleting one to make the prompt
read better reintroduces exactly the failure it names.

## QA before it ships

`get_knak_asset_html` writes the rendered HTML to the workspace and returns the
links, so the agent can check the things that actually go wrong — every link
resolving with correct and consistent UTMs, subject and preheader present, no
placeholder text left behind. Pair it with `parse_tracking_url`.

The `agent/skills/email-build.md` skill walks the whole workflow and loads
automatically when someone asks for an email.

## What this does not do

**It does not send.** It creates an asset in Knak. A human publishes or syncs it
to the marketing automation platform and sends from there. That boundary is
deliberate.

**It does not handle the Knak → MAP sync webhook.** Knak can POST an
`asset.sync_requested` webhook when someone publishes, which a custom MAP
integration receives and pushes into Marketo, Eloqua, Customer.io, or similar.
That is install-specific enough that it is not in the box; if you need it, the
pieces are a webhook route verifying the `knak-signature` HMAC, a fetch of the
asset's `content_link`, and a `PATCH /sync-statuses/{id}` reporting the outcome.

## Troubleshooting

- **"Knak did not return an asset id"** — generation was rejected before it
  started. Usually AI-generation access is off for the workspace, a quota is
  exhausted, or the API key's user cannot see the brand.
- **Generation fails every time with the same reason** — that is a real failure,
  not a blip. The tool already retries transient ones. A theme the brand cannot
  access is the common cause.
- **The email came back as a bare theme scaffold with none of the copy** — the
  body copy arrived garbled. Slack escapes `<`, `>`, and `&` in message text, so
  arrows like `->` land as `-&gt;`; `normalizeSlackText` handles that, so check
  the copy reached the tool intact.
- **A campaign name will not resolve** — folders nest and the list is one level
  at a time. The error names what was at that level; descend with
  `parent_folder_id`.
