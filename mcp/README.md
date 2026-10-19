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

The ceilings are read at runtime from [`src/assurance.json`](src/assurance.json),
the one file every REWORK surface renders them from:

<!-- rework-assurance:begin -->
**Workflow identity** (`workflow-identity`), moderate: strong on identity, silent on quality

Proves: GitHub cryptographically vouched that a specific workflow run belongs to a specific repository and commit, and REWORK recorded the authorship signals that run observed: commit signature state, whether each commit resolves to the pull request author, and how many commit messages declared AI assistance.

Does not prove: Nobody reviewed the code, ran it, or judged its quality. It does not say the work is good, only who the git history says wrote it. The AI count is what authors declared in commit messages: a zero means nothing was declared, not that no tool was used.

**Reviewed reference** (`reviewed-reference`), moderate: human-checked, but of a demonstration rather than the artefact

Proves: A REWORK reviewer watched a demonstration video and confirmed it corresponds to the claimed work, and the video is fingerprinted so reuse is detectable.

Does not prove: The reviewer did not audit the source, reproduce the result, or verify claims made verbally in the video.

**Cross-platform join** (`cross-platform-join`), moderate: strong on which bytes landed where and who controls both ends, silent on how they were made

Proves: The exact bytes named by a manifest digest were present in the named Hugging Face repository, at the named commit, immediately after the named GitHub Actions run, confirmed by REWORK's own independent read of the Hub; and one REWORK account holds both the App installation on the GitHub repository's owner and a verified write-control claim on the Hugging Face repository.

Does not prove: It does not prove that the workflow produced, trained, or evaluated the content. A run that downloads someone else's files and uploads them also carries bytes. Read the workflow reference to judge what the run actually did.
<!-- rework-assurance:end -->

`explain_rework_assurance` also returns `ai_declaration`: which commit-message
trailers count as declared AI assistance (read from
[`src/ai-trailers.json`](src/ai-trailers.json), the same list the Action and
the App check use). A declared count of zero means no message declared a
tool; it never means no tool was used.

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

- [REWORK Proof Check](https://github.com/reworkio/REWORK-Proof) — the
  GitHub Action that produces these attestations from a CI run.
- [REWORK Proof App](https://github.com/apps/rework-proof) — the same
  verification posted automatically as a check run on every pull request.

## Licence

MIT — see [LICENSE](LICENSE).
