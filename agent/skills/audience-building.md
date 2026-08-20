---
description: Use when someone describes an audience or segment in marketing language and you need to turn it into a concrete, checkable query — "enterprise accounts in EMEA who came to a webinar", "everyone in the nurture track who hasn't opened in 90 days".
---

# Turning a described audience into a query

A described audience is a hypothesis. Your job is to make it explicit, get it
confirmed, and only then act on it.

## 1. Translate the words

Check the audience vocabulary in your instructions first — it maps this org's
marketer-speak onto real field paths, including fields to avoid and why. If a
term is not in the vocabulary, do not guess between two plausible fields: name
both and ask which one they mean. Offer to add the answer to the vocabulary at
/audience-vocab so the next person does not have to re-litigate it.

Watch for terms that are quietly ambiguous:

- "customers" — closed-won accounts, or people with a paid subscription today?
- "active" — active record, active subscription, or recently engaged?
- "EMEA" — a field on the Account, a field on the Contact, or inferred from
  country? These give different answers and the difference is often 20%.
- "engaged" — almost always needs a definition and a time window.

## 2. Size it before you build it

Run the count first, and break it down along whatever dimension is most likely
to reveal a mistake — country, segment, created date, source. A number that is
suspiciously round, suspiciously large, or suspiciously small is a signal your
translation is wrong, not that the data is surprising.

State the count and the breakdown back to the user with the exact filter you
used, in their language and in field terms. This is the step that catches
misunderstandings while they are still free.

## 3. Check what you are about to exclude

Two silent exclusions cost real money:

- **Nulls.** A `!=` filter drops null rows. Say how many rows have a null in
  each filtered field.
- **Opt-outs and compliance.** Anyone being emailed needs the opt-out and
  suppression fields in the filter — `HasOptedOutOfEmail`, `DoNotCall`, any
  org-specific unsubscribe or GDPR field. Never leave these to be filtered
  "later in the platform"; filter them here and say you did.

## 4. Materialize it

Export to CSV in the workspace rather than reading the rows. Then you can
actually check the shape of what you built: duplicate emails, missing emails,
role addresses (`info@`, `sales@`), free-mail domains where you expect
corporate ones, test records. Report what you found before anyone sends to it.

## 5. Hand it off

Say which system it should live in and what happens next. Adding contacts to a
Salesforce campaign, a HubSpot list, or a Marketo static list are three
different things with three different downstream effects; confirm which one is
wanted before writing.
