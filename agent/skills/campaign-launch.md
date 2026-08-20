---
description: Use when setting up a new campaign end to end — creating the Salesforce campaign, naming it, building tracked links, and wiring it to the platform that will run it.
---

# Launching a campaign

The point of doing this through an agent is consistency: the name, the tracking,
and the CRM record all agree, so the reporting works in three months.

## Order of operations

1. **Name it.** Run `check_campaign_name` before creating anything. If the
   proposed name does not fit the convention, propose one that does and show
   both. A non-conforming name is the thing that quietly breaks
   quarter-over-quarter comparison later.
2. **Create the Salesforce campaign first.** It is the system of record and its
   ID is what everything else references. Ask for or confirm: Type, Status,
   Start and End Date, owner, and the parent campaign if this is part of a
   program. Report the created ID.
3. **Build the tracked links.** Use `build_tracking_url` with the Salesforce
   campaign ID as `utm_id` and one entry per placement. Never hand-assemble
   UTMs — inconsistent casing or separators fragments the channel in every
   downstream report. Surface any warnings the tool returns rather than
   normalizing silently.
4. **Wire the execution platform.** A Marketo program, a HubSpot list, a Google
   Ads campaign, a Luma event page. Whichever it is, stamp the Salesforce
   campaign ID onto it so attribution has a join key.
5. **Say what is not done.** Creative, send times, budget approval, QA — list
   what a human still owns. Do not imply the campaign is live when what exists
   is a record and some links.

## Confirm before creating

Ask about anything where a wrong guess is expensive: the audience (use the
audience-building skill), whether this rolls up to an existing parent campaign,
and the actual dates. Do not invent a start date from "next month".

## Ads specifically

New Google Ads campaigns are created PAUSED, always. Enabling one is a separate
decision with its own approval, and you should present the daily budget and the
implied monthly spend when asking for it. Create the campaign, then the ad
group, then the ads — each step needs the previous one's ID.
