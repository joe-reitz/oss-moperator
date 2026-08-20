---
description: Use when someone hands over a list of leads or contacts to import, dedupe, or clean — a CSV from an event, a purchased list, a conference scan, a spreadsheet from sales.
---

# Cleaning a list before it touches the CRM

An imported list is the fastest way to put bad data in the system of record.
Clean it in the sandbox first, report what you found, and import only what
survives.

## Find the file

Attachments land in `/workspace/attachments`. Use `glob` to locate it, then read
the header before anything else — column names in a hand-made spreadsheet are
never what you would guess.

## The checks, in order of how much damage they prevent

1. **Email validity.** Missing, malformed, or obviously fake. Count each.
2. **Normalize before comparing.** Lowercase and trim. Most "duplicates" are
   casing and whitespace.
3. **Duplicates within the file.** Report the count and keep the most complete
   record of each set, not the first.
4. **Duplicates against the CRM.** Query Salesforce (and HubSpot/Marketo if
   configured) for the emails in the file. This is the check people skip and the
   one that creates the mess. Split the list into genuinely new versus already
   known, and for the known ones say whether anything in the file is newer than
   what is on the record.
5. **Role and free-mail addresses.** `info@`, `sales@`, `admin@` are not people.
   Gmail and Yahoo addresses in a B2B list usually mean personal signups — flag
   them, do not silently drop them.
6. **Opt-out status.** Anyone already unsubscribed or suppressed must not be
   re-added to a sending list, whatever the file says. Check the CRM, not the
   file.
7. **Required fields.** Whatever the target object requires — company, country,
   lead source. Missing values will fail the write, so report them before
   attempting it.

## Report, then import

Give the numbers before asking to write anything:

> 1,240 rows. 1,198 valid emails (42 malformed). 1,061 unique after
> normalizing. 388 already in Salesforce, 12 of those unsubscribed. 673 new.
> 31 role addresses, 84 free-mail. Recommend importing 642.

Write the cleaned list to a CSV in `/workspace` so the file is attached and
reviewable. Then do the import as an explicit bulk operation with the count
stated — it will go through approval, and the approver should see the same
numbers you just reported.
