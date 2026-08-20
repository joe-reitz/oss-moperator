---
description: Use when writing, debugging, or optimizing a SOQL query, or when a Salesforce query returned an error, zero rows, or a suspicious count.
---

# Writing SOQL that works the first time

## Before you write

Call `describe_salesforce_object` on every object in the query unless you have
already seen its schema this session. Filter with `name_filter` — pulling 400
fields to find one wastes context. If you do not know the object's API name, use
`list_salesforce_objects` with a name filter; custom objects end in `__c` and
custom fields do too.

## The traps, in the order they bite

**Relationship traversal.** From a child you traverse up with dots and it is
cheap: `SELECT Id, Account.Name, Account.Industry FROM Contact`. From a parent
you need a subquery and the *plural* relationship name, which for custom objects
ends in `__r`: `SELECT Id, (SELECT Id, Email FROM Contacts) FROM Account`. Using
`Contact` instead of `Contacts` there is the single most common failure.

**COUNT().** `SELECT COUNT() FROM X` returns a count with no records — read it
off the result's count, not its rows. `SELECT COUNT(Id), Status FROM X GROUP BY
Status` gives you the breakdown, which is usually what someone actually wanted.

**Date literals beat computed dates.** Prefer `LAST_N_DAYS:30`, `THIS_QUARTER`,
`LAST_QUARTER`, `THIS_FISCAL_QUARTER`, `LAST_FISCAL_QUARTER`, `TODAY`,
`YESTERDAY`. Note the fiscal variants: if the org's fiscal year is offset,
`THIS_QUARTER` and `THIS_FISCAL_QUARTER` are different answers, and reporting
usually means the fiscal one. Datetime fields need a full ISO timestamp
(`2026-01-01T00:00:00Z`); date fields must not have one.

**Quoting.** String literals take single quotes. Picklist values are matched
against the API value, not the label, and they are case-sensitive. Booleans and
numbers are unquoted. An escaped quote inside a literal is `\'`.

**Nulls.** `WHERE Field__c != 'x'` silently excludes rows where the field is
null. If you mean "everything that is not x", write
`WHERE (Field__c != 'x' OR Field__c = NULL)`.

**Deleted and archived rows.** Standard queries hide them. If a count is lower
than someone expects, that is often why.

**Multi-select picklists** need `INCLUDES ('A;B')` / `EXCLUDES`, not `=`.

## Zero rows

Do not report "no results" and stop — that is usually a query bug, not a fact.
Take the filters off one at a time until rows appear, and report which filter was
responsible. A picklist label used where the API value was needed is the usual
culprit.

## Result size

`query_salesforce` shows you the first 50 rows and tells you the true count.
When the count is larger than you can reason about, or the user wants the data:
use `export_salesforce_query` and work on the file. Do not paginate by hand
through `query_salesforce` — it already paginated, it just truncated the display.

## Selectivity

A `WHERE` clause on an unindexed field over a large object can time out. Indexed
fields are `Id`, `Name`, `OwnerId`, `CreatedDate`, `SystemModstamp`, foreign
keys, and anything marked External ID or Unique. Lead with one of those, then
narrow. `LIKE '%text%'` cannot use an index at all — anchor it as `'text%'` when
you can.
