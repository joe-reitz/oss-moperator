---
description: Use when someone asks for an email to be built — a request post with subject/copy/CTA fields, approved copy pasted into a thread, or "build me an email about X". Also for QA'ing an email before it ships.
---

# Building an email

Knak builds the email. You do not write HTML, and you do not rewrite copy.

## First: is there approved copy?

This is the only question that changes what you do.

**Yes — someone gave you copy.** A request post, a pasted draft, a doc. Use the
structured path: pass `body_copy` to `generate_knak_email`, along with whatever
else they supplied — `subject`, `preheader`, `cta_text`, `cta_link`.

The copy goes through verbatim. Do not tighten the headline, fix the grammar,
shorten a bullet, or improve the CTA. That copy has usually been through review,
sometimes legal review, and changing a word can be a real problem. If something
in it looks wrong, ship it as given and say what you noticed.

**No — they described what they want.** "An email announcing the pricing page."
Use `prompt` and let Knak write it. Do not draft the copy yourself and pass it as
`body_copy` — Knak writes better on-brand copy than a generic draft, and
`body_copy` means "this is final", which yours is not.

## Getting the request fields right

A structured intake post usually looks like this:

```
Logo: Acme
Region: NAMER
Type: Email
Template: Standard Email
Subject Line: Introducing usage-based pricing
Pre-header: Pay for what you use, nothing more
Body Copy: <multi-line copy, often with bullets and links>
CTA Button Text: See the new pricing
CTA Button Link: https://acme.com/pricing
Target send date: 2026-09-14
Requester: @dana
```

Map those onto the tool: Logo → `brand_name`, Subject Line → `subject`,
Pre-header → `preheader`, Body Copy → `body_copy`, CTA Button Text/Link →
`cta_text`/`cta_link`, Region → `region`, Type → `type`, Target send date →
`target_send_date`.

**Take the body copy exactly as written**, including its line breaks, bullets,
bold, and links. Do not reflow it into a paragraph.

## Naming

Knak cannot rename an asset after it is created, so the name has to be right the
first time. Do not invent one — supply `region`, `type`, `title`,
`target_send_date`, and `ticket`, and the convention is applied for you.

If the request has a tracker ticket (filed by you, or posted in the thread), pass
it as `ticket`. That is what makes an asset in Knak traceable back to the request
six weeks later, and there is no way to add it afterwards.

Only pass `asset_name` when someone dictated an exact name.

## Where it lands

Name a campaign if the user did, otherwise the configured default folder is used.
If a campaign name does not resolve, `list_knak_campaigns` shows what exists at
that level — folders nest, so you may need to descend with `parent_folder_id`
rather than assuming the name is wrong.

## While it generates

It takes one to two minutes and the tool waits. Say what you are building before
you call it, so nobody is watching a silent thread.

If it comes back `generating`, generation is slow rather than broken — give the
user the link and offer to check with `get_knak_asset`.

If it fails, report Knak's own reason. The usual causes are a theme the brand
cannot access, an AI generation quota, or copy that tripped a content filter.

## QA before it ships

`get_knak_asset_html` writes the HTML to the workspace; `qa_email` checks it.
Run both — the checker covers untracked links, UTM casing that will split a
channel, missing alt text, unreplaced merge tokens, placeholder copy, a missing
unsubscribe link, and a subject that will truncate.

Treat its severities differently. **blocking** means do not send. **warning**
means someone should look. **note** is informational.

Two things the checker cannot do for you:

- **Confirm the copy matches what was approved.** Diff it against the request.
- **Judge whether the email is any good.** It checks mechanics, not persuasion.

Report what you checked as well as what you found, so "clean" means something.
Do not paste the HTML into the thread.

## What not to do

- Do not compose email HTML. That is Knak's job and yours will not be on-brand.
- Do not use a generic content-drafting tool for a Knak email.
- Do not describe the email's contents from memory. Report what the tool returned.
- Do not send anything. This builds an asset in Knak; a human sends it from the
  marketing automation platform.
