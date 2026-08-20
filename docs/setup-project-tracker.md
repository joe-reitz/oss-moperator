# Connect a project tracker

mOperator files bugs, requests, and tasks into whichever tracker your team
already uses. Five are supported:

| Tracker | Variables |
| --- | --- |
| **Linear** | `LINEAR_API_KEY`, `LINEAR_TEAM_NAME` |
| **Asana** | `ASANA_ACCESS_TOKEN` (+ `ASANA_WORKSPACE_ID`, `ASANA_PROJECT_ID`) |
| **Jira Cloud** | `JIRA_SITE`, `JIRA_EMAIL`, `JIRA_API_TOKEN` (+ `JIRA_PROJECT_KEY`, `JIRA_ISSUE_TYPE`) |
| **monday.com** | `MONDAY_API_TOKEN` (+ `MONDAY_BOARD_ID`) |
| **ClickUp** | `CLICKUP_API_TOKEN` (+ `CLICKUP_TEAM_ID`, `CLICKUP_LIST_ID`) |

Configure one. The tools are the same either way —`file_tracker_issue`,
`query_tracker_issues`, `list_tracker_projects`, and where the tracker supports
them `comment_on_tracker_issue`, `set_tracker_issue_status`, and
`list_tracker_statuses`. Only the backend changes, so switching trackers later is
a credential change, not a code change.

The agent also picks up each tracker's vocabulary, so it says "task" for Asana,
"issue" for Jira, "item" for monday, and "board" or "list" where those apply.

---

## Asana

1. Go to [Asana → My Settings → Apps → Developer apps](https://app.asana.com/0/my-apps).
2. Create a **Personal access token** and copy it.

```bash
ASANA_ACCESS_TOKEN=2/1234567890/abcdef...
```

Optional, but recommended:

```bash
# Only needed if your token can see more than one workspace. The agent will
# tell you the ids if it needs this.
ASANA_WORKSPACE_ID=1201234567890123

# The project new tasks land in when nobody names one. Get it from the project
# URL — https://app.asana.com/0/1203456789012345/list — or by asking the agent
# to list projects.
ASANA_PROJECT_ID=1203456789012345
```

**Priority.** Asana has no built-in priority field. Most workspaces add a
"Priority" custom field, and mOperator looks for an enum field whose name
contains "priority" on the target project and sets the matching option. If there
isn't one, the task is still created and the result says the priority was not
applied — it will not fail the call or silently drop it.

**Descriptions** go in as plain text. Asana notes are not markdown, so headings
and bold would render literally.

**Statuses.** Asana models done-ness as a checkbox, not a status list, so only
`open` and `completed` are accepted. Moving a task between sections is a
different concept and is not supported here.

## Jira Cloud

1. Go to [id.atlassian.com/manage-profile/security/api-tokens](https://id.atlassian.com/manage-profile/security/api-tokens).
2. **Create API token**, copy it.

```bash
JIRA_SITE=acme                 # or acme.atlassian.net, or the full URL
JIRA_EMAIL=you@acme.com        # the account the token belongs to
JIRA_API_TOKEN=ATATT3x...
JIRA_PROJECT_KEY=MKTG          # default project
JIRA_ISSUE_TYPE=Task           # defaults to Task
```

**Priority names are per-project.** mOperator maps its four levels onto Jira's
defaults — Highest, High, Medium, Low. If your project uses a custom priority
scheme, Jira rejects those names; the issue is created without a priority and the
result tells you, rather than the whole call failing.

**Issue types are per-project too.** `Task` exists in most projects, but if yours
uses `Story` or something custom, set `JIRA_ISSUE_TYPE`.

**Statuses move by transition.** Jira does not let you set a status directly, so
`set_tracker_issue_status` finds the transition leading to the status you named.
If there isn't one from the issue's current status, the error lists what is
available.

**Descriptions are converted to Atlassian Document Format**, Jira's JSON
document structure. Paragraphs and bullet lists survive; richer markdown degrades
to plain paragraphs rather than failing.

## monday.com

1. Go to your avatar → **Administration → Connections → API**, or
   **Developers → My access tokens**.
2. Copy the personal API token.

```bash
MONDAY_API_TOKEN=eyJhbGci...
MONDAY_BOARD_ID=1234567890     # default board
```

**Boards only have the columns someone made.** monday has no fixed status or
priority field, so mOperator looks for columns whose title matches
"status"/"priority"/"date" and uses them. When a board has none, the item is
still created and the result lists what could not be applied.

**Items have no description field.** The body is posted as the item's first
update (monday's word for a comment), which is where a long description belongs
in monday anyway.

## ClickUp

1. Go to your avatar → **Settings → Apps → API Token**.
2. **Generate**, then copy it.

```bash
CLICKUP_API_TOKEN=pk_12345_ABCDEF
CLICKUP_TEAM_ID=9001234567      # only if the token sees several workspaces
CLICKUP_LIST_ID=901234567890    # default list — this is the one that matters
```

ClickUp nests workspace → space → folder → list, and tasks are created against a
**list**. Ask the agent to list projects and it walks the hierarchy for you,
including folderless lists, which are easy to miss in the UI.

## Linear

1. Go to [Linear → Settings → API → Personal API keys](https://linear.app/settings/api).
2. Create a key.

```bash
LINEAR_API_KEY=lin_api_...
LINEAR_TEAM_NAME=ENG            # the team KEY, not its display name
```

`LINEAR_TEAM_NAME` is the short key from issue identifiers — the `ENG` in
`ENG-421`. This integration is pinned to one team; issues are filed into its
Triage state. Assignee and due date are not set through this path.

---

## Using more than one

Some organizations genuinely run two — marketing in Asana, engineering in Jira.
Configure both, then name the default:

```bash
ASANA_ACCESS_TOKEN=...
JIRA_SITE=acme
JIRA_EMAIL=you@acme.com
JIRA_API_TOKEN=...
MOPERATOR_TRACKER=asana
```

The tools then take an optional `tracker` parameter listing exactly the
configured ones, so the agent can file an engineering bug into Jira and a
campaign task into Asana in the same conversation. With one tracker configured
that parameter does not exist at all, which is why the common case stays simple.

If `MOPERATOR_TRACKER` is unset, the first configured tracker wins in the order
Linear, Asana, Jira, monday, ClickUp. Set it explicitly if you have more than one
— relying on that order is fragile.

## Try it

```bash
npm run agent:info    # confirm the tracker is active
npm run agent
```

> Bug: the pricing page form drops UTM parameters when someone arrives from
> LinkedIn

The agent writes the issue — an imperative title, a body with what happens versus
what should happen, a priority based on impact, and labels — files it, and
replies with the URL. Because it has the whole conversation, it can pull in
context from earlier in the thread without you repeating it.

Then:

> What's still open from this week?

## Adding another tracker

Implement `TrackerProvider` from `agent/lib/trackers/types.ts` and add it to
`PROVIDERS` in `agent/lib/trackers/index.ts`. That is the whole change — no tool
edits, because the tools are written against the interface.

`createIssue` and `queryIssues` are required. `addComment`, `setStatus`, and
`listStatuses` are optional, and their tools are only advertised when some
configured provider implements them.

Use the `note` field on a returned issue when your provider could not apply part
of the request. That is how the Asana adapter reports a missing priority field
rather than pretending it worked.

## Not using the REST API

Several of these also have MCP servers, which give you the vendor's full surface
instead of this shallow common one — at the cost of a tool set that changes per
vendor and does not go through mOperator's approval policies. See
[More capabilities](connections.md) for the trade-off and how to add one.
