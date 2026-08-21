---
description: Use when someone hands over a list of leads or contacts to import, dedupe, or clean — a CSV from an event, a purchased list, a conference scan, a spreadsheet from sales.
---

# Cleaning a list before it touches the CRM

An imported list is the fastest way to put bad data in the system of record.
Clean it in the sandbox first, report what you found, and import only what
survives.

## The three tools, in order

There are dedicated tools for this and you should use them rather than doing it
by hand in the sandbox. The parts that go wrong are mechanical — SOQL cannot take
a thousand emails in one `IN` clause, Salesforce caps an insert at 200 records
per call, and "duplicate" means normalized-and-compared rather than string-equal.
The tools handle all three; a hand-rolled version gets it subtly wrong on a big
file, silently.

1. **`inspect_list`** — what is wrong with the file
2. **`dedupe_list_against_salesforce`** — new vs already-known vs suppressed
3. **`create_salesforce_records`** — one bulk insert of what survived

## Find the file

Attachments land in `/workspace/attachments`. Use `glob` to locate it. Then run
`inspect_list` — it finds the email column for you, since column names in a
hand-made spreadsheet are never what you would guess.

## The checks, in order of how much damage they prevent

1. **Email validity.** Missing, malformed, or obviously fake. Count each.
2. **Normalize before comparing.** Lowercase and trim. Most "duplicates" are
   casing and whitespace.
3. **Duplicates within the file.** Report the count and keep the most complete
   record of each set, not the first.
4. **Duplicates against the CRM.** `dedupe_list_against_salesforce` checks both
   Contact and Lead in chunked queries and writes three files — new, existing,
   suppressed. This is the check people skip and the one that creates the mess.
   For the already-known rows, say whether the file has newer information than
   the record does.
5. **Role and free-mail addresses.** `info@`, `sales@`, `admin@` are not people.
   Gmail and Yahoo addresses in a B2B list usually mean personal signups — flag
   them, do not silently drop them.
6. **Opt-out status.** The dedupe step separates these out for you. Anyone
   already unsubscribed or bounced must not be re-added to a sending list,
   whatever the file says — and the file is often wrong, because it predates the
   opt-out. Trust the CRM, not the spreadsheet.
7. **Required fields.** Whatever the target object requires — company, country,
   lead source. Missing values will fail the write, so report them before
   attempting it.

## Report, then import

Give the numbers before asking to write anything:

> 1,240 rows. 1,198 valid emails (42 malformed). 1,061 unique after
> normalizing. 388 already in Salesforce, 12 of those unsubscribed. 673 new.
> 31 role addresses, 84 free-mail. Recommend importing 642.

The dedupe step already wrote the cleaned files, so they are attached and
reviewable. Then import with `create_salesforce_records`, passing the `new_path`
it produced rather than pasting thousands of rows through the conversation.

Confirm the required fields first with `describe_salesforce_object` — a missing
`Company` on Lead fails every row. Use `field_map` to rename columns
(`{"Work Email": "Email"}`) and `defaults` for values that apply to the whole
file (`{"LeadSource": "Conference"}`).

Partial success is normal: good rows land and bad rows come back with reasons.
Report both counts, and do not re-run the whole file to retry a handful.
