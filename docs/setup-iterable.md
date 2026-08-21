# Connect Iterable

One credential, and a five-minute setup. The interesting part is not the setup —
it is the two Iterable behaviours that produce silent, hard-to-undo messes.

---

## Step 1: Create an API key

1. In Iterable, go to **Integrations → API Keys**
2. **New API Key**, name it `mOperator`
3. Choose a **server-side** key
4. Copy the value — Iterable cannot show it again

```bash
ITERABLE_API_KEY=your-api-key
```

You need to be an org admin, or have the *Manage Integrations* permission.

## Step 2: Region, if you are on EDC

Iterable runs US (USDC) and EU (EDC) data centres on different hosts. If your
project is EU-hosted:

```bash
ITERABLE_REGION=eu
```

## Step 3: Check it

```bash
npm run agent:doctor
```

It lists lists through the real client. Note what it does when the key is valid
but the project is empty: it reports a **warning**, not success — because that is
almost always the next problem, described below.

---

## Keys are scoped to one project

An Iterable key can only read and write the project it was created in. A key from
the wrong project **authenticates perfectly and sees nothing**. So "the agent says
we have no lists" is usually a key from the wrong project, not a broken key or an
empty account. `agent:doctor` calls this out rather than reporting a cheerful zero.

## Email or userId — pick one and never mix

This is the one that causes real damage.

Iterable keys profiles on **email** by default. Set `preferUserId` and it keys on
**userId** instead. Both are legitimate. What is not survivable is mixing them for
the same person: you get two profiles for one human, and merging them afterwards
is genuinely painful.

The agent cannot infer which convention your workspace uses, so it is told to stay
consistent with whatever it finds and to ask if it is ambiguous. If your workspace
is userId-keyed, say so once and it will follow.

A write with neither an email nor a userId is refused before it reaches Iterable,
because Iterable's own error for that case is unhelpful.

## Field types are fixed on first write

Iterable infers a `dataFields` field's type the first time you write it, then
rejects conflicting types forever. A field ever written as text will refuse a
number later. This is why an import that worked in staging can fail in production
against the same field name.

There is no fix from the API side — the field has to be corrected in Iterable. Get
it right the first time, especially for anything numeric or date-like.

---

## What the agent can do

**Read** — look up a user by email, list lists, read a list's membership, list
campaigns and templates, read campaign metrics over a date range.

**Write** — create or update users singly or in bulk, subscribe and unsubscribe
people from static lists, record custom events.

**Send** (always approved) — send an existing campaign's email to one person.

## Things worth knowing

**Chunking is automatic.** Iterable caps list subscribe, unsubscribe, and bulk
user update at 1,000 records per call. The client chunks; do not split the input
yourself, and do not try to get under an approval threshold by splitting — the
threshold is per call and the agent is told why.

**`lists/getUsers` returns plain text.** Not JSON — one email per line. The client
parses it into a count and an array. It also returns *every* address on the list,
so for a large list ask for the count from `list_iterable_lists` instead of
pulling the whole membership into the conversation.

**A 200 can still be a failure.** Most Iterable endpoints answer
`{msg, code, params}` where `code` is the real verdict. A bad list id comes back
HTTP 200 with a non-Success code, so the client checks `code` rather than just the
status. If you extend this client, keep that check.

**Subscribing creates people.** `lists/subscribe` creates users who do not exist
yet. That is convenient and also means a typo'd address becomes a real profile.

**List membership is a step towards sending.** Adding someone to a list is what
makes them reachable by campaigns targeting it. The agent treats it as a write
needing approval at bulk sizes for that reason.

## Further reading

- [Iterable API reference](https://api.iterable.com/api/docs) — EU projects: `https://api.eu.iterable.com/api/docs`
- [Iterable API keys](https://support.iterable.com/hc/en-us/articles/360043464871-API-Keys)
- [Adding integrations](adding-integrations.md)
