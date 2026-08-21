---
description: Use when analyzing a data set rather than answering a lookup — campaign performance comparisons, funnel or conversion questions, attribution, list hygiene, deduping, or anything involving a CSV a person uploaded.
---

# Analyzing data in the sandbox

You have an isolated Linux filesystem at `/workspace` with bash, Python, and
pandas. Use it. Reading 50 rows out of 200,000 and generalizing is how a
quarterly review ends up wrong.

## The shape of the work

1. **Get the data to disk.** `export_salesforce_query` writes the full result
   set to `/workspace` and hands you a path, a row count, and the columns.
   Files a person attached in Slack are already there, under
   `/workspace/attachments` — find them with `glob`.
2. **Look before you compute.** `head -5` the file and check the columns are
   what you expect. Relationship fields arrive as dotted names like
   `Account.Name`.
3. **Compute in a script, not in your head.** Write a `.py` file to
   `/workspace/scratch/` and run it. Never do arithmetic on rows mentally, and
   never estimate a total from a sample.
4. **Report the answer, not the data.** Print a small summary — the aggregate,
   the top and bottom few, the outliers, the row count everything is based on.
   That summary is what goes in your reply.

```bash
python3 - <<'PY'
import pandas as pd
df = pd.read_csv("/workspace/campaign-members-2026-08-20.csv")
print(df.shape)
print(df.dtypes)
print(df["Status"].value_counts())
PY
```

## Things worth checking every time

**Row counts at every step.** Print the count before and after each filter or
join. A join that silently drops 40% of rows is the most common way an analysis
goes wrong, and it is invisible unless you look.

**Dates as dates.** `pd.to_datetime(..., errors="coerce")` then count the NaTs.
Salesforce datetimes are UTC; if the question is about "last week", the timezone
boundary matters.

**Duplicates, deliberately.** Decide what a duplicate *is* before deduping —
same email, same email lowercased and trimmed, same person across two records.
Report how many you collapsed and on what key.

**Denominators.** A conversion rate needs both numbers stated. "12% conversion"
with no denominator is not a finding, and 3-of-25 is a different claim from
1,200-of-10,000.

**Division by zero and empty groups.** Guard them. A campaign with no clicks
has no CPC, not an infinite one.

## Presenting it

Lead with the number that answers the question. Then a small markdown table —
five to ten rows, not fifty. Then the caveats: what was excluded, what looked
wrong in the data, what you had to assume.

If a person wants the underlying rows, write them to a CSV in `/workspace` and
say so; the file gets attached to your reply.

If a comparison is the point, use `compare_rates` rather than eyeballing it. Two
campaigns at 2.1% and 2.4% on 400 clicks each are not distinguishable, and the
tool will say so with a p-value and the sample size that *would* settle it.
Report its verdict as given — do not soften "not distinguishable" into "A is
slightly ahead", which is the exact error it exists to prevent.
