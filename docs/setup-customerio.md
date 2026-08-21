# Connect Customer.io

Customer.io is two APIs with two different credentials, and picking the wrong one
is the single most common setup mistake here. Worth two minutes before you start.

| | App API | Track API |
| --- | --- | --- |
| Host | `api.customer.io/v1` | `track.customer.io/api/v1` |
| Auth | Bearer token | HTTP Basic |
| Credential | one App API key | Site ID **and** Track API key |
| Does | reads people, segments, campaigns, broadcasts; sends transactional email | writes people, records events, changes manual segment membership |
| Required here | **yes** | optional |

Only the App API key is required. Set it and you get every read plus transactional
sending. Add the Track credentials when you want the agent to write.

---

## Step 1: Get the App API key

1. In Customer.io, go to **Settings → Account Settings → API Credentials**
2. Open the **App API Keys** tab
3. **Create App API Key**, name it `mOperator`
4. Copy it — Customer.io shows it once

```bash
CUSTOMERIO_APP_API_KEY=your-app-api-key
```

## Step 2: Pick your region

This one costs people an hour. Customer.io runs separate US and EU stacks, and a
key from one region against the other's host returns **401** — identical to a bad
key. If your workspace is EU-hosted:

```bash
CUSTOMERIO_REGION=eu
```

Leave it unset for US. The client reports the region it used in its 401 message,
so if you see that error, check this before regenerating the key.

## Step 3 (optional): the Track credentials

Only needed for writes. Same page, **Tracking API Keys** tab:

```bash
CUSTOMERIO_SITE_ID=your-site-id
CUSTOMERIO_TRACK_API_KEY=your-track-api-key
```

Without these, the write tools fail with a message naming both variables rather
than a bare 401 — an unset credential should not look like a broken one.

## Step 4: Check it

```bash
npm run agent:doctor
```

It reads segments through the real client, so a wrong region or host shows up here
rather than mid-conversation. With no Track credentials it reports a **warning**
rather than a failure, and says which capabilities that costs you.

---

## What the agent can do

**Read** — look someone up by email, search people with a filter, list segments
and their membership, list campaigns and read their delivery metrics, list
broadcasts.

**Write** (needs Track) — create or update a person, record an event, add and
remove members of manual segments.

**Send** (always approved) — send one transactional email, or fire an
API-triggered broadcast.

## Things that will bite you

**Manual segments only.** Only *manual* segments accept membership changes. A
data-driven segment computes its own membership and Customer.io rejects the call.
Ask the agent to list segments first — the type is in the response.

**Identify is an upsert with no safety net.** `PUT` to an unknown identifier
*creates* a person rather than erroring. A typo in an identifier quietly makes a
new profile, so check the identifier before bulk-writing.

**Events cause sending.** Recording an event is not itself a send, but events
start campaigns. The agent treats event writes as writes needing approval for
exactly this reason.

**A broadcast is the widest thing here.** One call reaches a whole segment.
Customer.io rate-limits broadcast triggers to one per ten seconds, which limits
accidents but is not a safety net. `trigger_customerio_broadcast` always requires
a human and can never run from a schedule.

**Transactional means existing.** `send_customerio_transactional_email` targets a
transactional message you already configured in Customer.io. It does not compose
copy; `message_data` fills that template's liquid variables.

## Rate limits

| Endpoint group | Limit |
| --- | --- |
| Most App API endpoints | 10 req/s |
| Transactional email | 100 req/s |
| Broadcast triggers | 1 per 10 s |

The client turns a 429 into a message that names these, so you are not left
guessing which bucket you hit.

## Further reading

- [Customer.io App API reference](https://docs.customer.io/integrations/api/app/)
- [Adding integrations](adding-integrations.md) — if you need an endpoint that is not here
