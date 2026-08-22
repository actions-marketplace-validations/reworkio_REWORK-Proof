# REWORK Proof — MCP server

Lets an AI agent answer *"is this delivered work genuinely theirs?"* without
taking anyone's word for it.

Point it at a REWORK Verifiable Credential and it reports whether the
signature holds, who issued it, what it claims — and, deliberately, what it
does **not** claim.

## Install

```json
{
  "mcpServers": {
    "rework-proof": {
      "command": "npx",
      "args": ["-y", "@reworkdigital.io/rework-proof-mcp"]
    }
  }
}
```

No API key. No account. Every tool here reads public endpoints.

## Tools

| Tool | What it does |
|---|---|
| `verify_rework_credential` | Checks a VC-JWT's signature and returns the issuer, the subject, and the ceiling on what the credential proves. |
| `get_rework_issuer_keys` | Fetches REWORK's public JWKS so you can verify offline yourself instead of trusting this server. |
| `explain_rework_assurance` | Explains what an assurance level proves and what it explicitly does not. |
| `lookup_rework_attestation` | Checks whether REWORK actually *issued* a credential — a forged-but-well-formed token fails this — and returns the current OpenTimestamps receipt, which may have been upgraded to a Bitcoin confirmation since issue. The credential is hashed locally; it never leaves your machine. |

### Why the verdict ships with a caveat

`verify_rework_credential` returns an `assurance_note` alongside `valid`.

An agent that reads only `valid: true` will treat every credential as equally
strong, and they are not. A `workflow-identity` attestation says GitHub
vouched for who wrote the commits — it says nothing about whether the code
works or is any good. Returning the verdict without its ceiling would invite
exactly that misreading, so the ceiling travels with it.

## Zero dependencies, on purpose

The whole server is one file: [`src/index.js`](src/index.js). MCP's stdio
transport is newline-delimited JSON-RPC 2.0, which is small enough to
implement outright.

A tool whose entire job is verifying authenticity has no business asking you
to trust ninety transitive packages first. The supply chain is part of the
claim. Node 20's built-in `fetch` covers the rest.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `REWORK_API_URL` | `https://api.reworkdigital.io/api/v1` | Override for self-hosted REWORK. |

## Verifying without this server

Credentials are signed with Ed25519 and REWORK's public key is published at
`https://api.reworkdigital.io/api/v1/proofs/credentials/jwks.json`. Any JOSE
library verifies one offline, with no call to REWORK and no dependency on us
continuing to exist. That is the point of issuing them this way — this server
is a convenience, not an authority.

## Related

- [REWORK Proof Check](https://github.com/Reworkdigital-io/REWORK-Proof) — the
  GitHub Action that produces these attestations from a CI run.
- [REWORK Proof App](https://github.com/apps/rework-proof) — the same
  verification posted automatically as a check run on every pull request.

## Licence

MIT — see [LICENSE](LICENSE).
