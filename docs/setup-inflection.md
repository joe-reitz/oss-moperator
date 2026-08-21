# Connect Inflection

Inflection is B2B marketing automation built on product and sales data. Its public
API (V1) covers contacts, lists, activity, and email objects.

One credential, and then one rule you have to internalise: **property keys must be
snake_case**. More on why that matters below — it is the only integration here
where getting a key name wrong loses data without erroring.

---

## Step 1: Get a Personal Access Token

1. In Inflection, go to **Settings → API**
2. Create a **Personal Access Token**
3. Give it READ and WRITE, or READ alone if you want the agent read-only
4. Copy it

```bash
INFLECTION_API_TOKEN=your-personal-access-token
```

An OAuth 2.1 access token works in the same header if you have one; the client does
not care which it is.

Scopes show up as distinguishable errors: a **401** means the token is missing,
expired, or revoked; a **403** means it authenticated but lacks the permission for
that verb. If you want a read-only agent, issue a READ-only token and the write
tools will fail cleanly rather than needing to be deleted.

## Step 2: Check it

```bash
npm run agent:doctor
```

It looks up an address that will never exist. A clean "not found" is a successful
authenticated round trip — which is the point of a read-only probe.

---

## The snake_case rule

Inflection accepts camelCase property keys, returns success, and **stores null**.

There is no error. Nothing to catch later. You find out when a field you thought
you populated is empty across every contact you wrote.

So this client refuses camelCase up front:

```
Inflection contact properties keys must be snake_case — camelCase keys are
silently saved as null. Rename: firstName → first_name, lastName → last_name
```

Use `first_name`, `company_name`, `utm_source`. Not `firstName`.

One confusing asymmetry, because it is worth knowing rather than discovering:
*property* keys are snake_case, but request *body* fields are camelCase —
`contactIds`, `transactionId`. That is Inflection's shape, not a typo here.

## Writes are asynchronous

Contact writes do not return a contact. They return a **PENDING transaction**, and
you poll `GET /v1/contacts/transactions/{id}` until it says `DONE`.

The client polls for you — briefly — and reports the per-contact outcomes, so the
agent tells you "3 created, 1 updated, 1 failed" rather than handing you an opaque
id. If a batch is still in flight when the poll window closes, it returns the
transaction id and the agent can check it with `get_inflection_transaction`.

The poll is bounded on purpose. A tool that returns PENDING has told the model
nothing, but an unbounded poll can hang a whole turn.

One quirk to know if you extend this: an unrecognised transaction id returns
`NOT_EXIST` over **HTTP 200**. The status code cannot be trusted to detect it.

## Upsert, not create

`upsert_inflection_contacts` always uses the batch endpoint, even for a single
contact. That is deliberate: a plain `POST` to the single-contact endpoint only
*creates*, so it fails on anyone who already exists. Batch upsert is the
dependable create-or-update route — new addresses come back `CREATED`, known ones
`UPDATED`.

Maximum 1,000 contacts per call, handled as one transaction.

---

## What the agent can do

**Read** — look up a contact by email or id; read a contact's marketing activity,
product activity, or combined log; get a list and its members; check a transaction.

**Write** — create or update contacts in batches, create lists, add and remove
list members.

**Send** — nothing. This is deliberate and worth stating: the public API does not
expose "send this now", so there is no send tool to gate. Journeys do the sending
and they are driven from the app.

## Things worth knowing

**Adding list members is the step towards sending.** It is the closest thing to a
send available through the API, because list membership is what makes someone
reachable by a journey. Treat it with that in mind.

**Members are added by contact id, not email.** Look ids up first with
`get_inflection_contact`. Ids that cannot be resolved are **skipped, not failed** —
the call still returns 200 and reports them as warnings. So read the warnings to
confirm everyone actually landed; a successful call does not mean a complete one.

**A missing contact is a 400, not a 404.** Error code `BAS-E-002`. The client
translates it to a plain "not found" so it does not read as a transport failure.

**Activity needs a contact id.** The three activity streams answer different
questions — `marketing` is what we did to them, `product` is what they did, `log`
is the combined record.

## Not covered here

Inflection also offers an **MCP server**, which is a different integration path
entirely: it exposes journeys, audiences, and email building as tools rather than
REST endpoints. eve supports MCP connections natively, so if you want the agent
building journeys rather than managing contacts, that is the route — see
[More capabilities](connections.md).

This integration is the REST API, which is the right surface for contact and list
operations.

## Further reading

- [Inflection API reference](https://docs.inflection.io/api-reference/introduction)
- [Inflection MCP server](https://docs.inflection.io/agents/inflection-mcp)
- [Adding integrations](adding-integrations.md)
