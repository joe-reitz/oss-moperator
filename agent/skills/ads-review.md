---
description: Use when reviewing ad performance, diagnosing a campaign that is underperforming, or being asked whether to change budgets or pause something.
---

# Reviewing ad performance

## Get the whole picture first

`list_google_ads_campaigns` gives the account shape with lifetime numbers.
`get_google_ads_performance` over a date range gives you the trend, which is
what actually answers most questions. Pull both before forming a view — a
campaign with bad lifetime numbers that has improved for three weeks is a
different story from one that is steadily declining.

For anything beyond a handful of campaigns and days, that is a lot of rows.
Export or summarize in the sandbox rather than reading every row.

## The metrics that matter, and their traps

**Cost per conversion is the number**, not CPC and not CTR. A campaign with
cheap clicks and no conversions is worse than an expensive one that converts.

**Watch the denominator.** Cost per conversion on 3 conversions is noise. State
the conversion count alongside any efficiency metric, and say when a difference
is not distinguishable at that volume.

**Conversion lag.** Yesterday's conversions are not all in yet, and neither are
last week's for a long sales cycle. Never compare a recent partial window
against a complete one without saying so.

**Budget-capped is not the same as underperforming.** A campaign spending its
full daily budget every day is constrained, and its measured performance is not
telling you what it would do with more room. Check whether spend is pinned at
the cap before concluding anything about efficiency.

**Segment before recommending.** Aggregate account numbers hide the split. The
useful finding is almost always "these three campaigns are carrying it and these
two are the drag", not an account-wide average.

## Recommending a change

Say what you would change, by how much, and what you expect to happen. Then let
the approval prompt carry it — every budget and status change needs a spend
approver, every time, and you should present:

- current daily budget and the new one
- the monthly delta in dollars
- what the change is expected to do, and how you would know in a week

Prefer pausing a loser over raising a winner when the account is budget
constrained; it is the reversible move. Never propose a change large enough that
you would not be comfortable defending it if it did nothing.
