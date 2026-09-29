# Contracts Module

Placeholder for the later `target -> opportunity -> client -> contract` path.

0.4.0 landed the first half of that path: `accounts` are companies, `contacts`
are people, and every target carries a pipeline stage (`won` is the client
moment). Contracts start from a won target or the account it belongs to, and
will need their own tables rather than columns on `targets`.

Do not put contract fields in outreach tables.
