# REWORK Proof Check

Reports who actually wrote the commits in a pull request — signature state,
author attribution, and disclosed AI assistance — as a job summary.

By default it sends **nothing anywhere**. It reads the pull request's commits
with the token your workflow already has and writes a summary. No account, no
API key, no third-party access to your repository.

```yaml
name: Proof
on: pull_request

jobs:
  proof:
    runs-on: ubuntu-latest
    steps:
      - uses: Reworkdigital-io/REWORK-Proof@v1
```

That's the whole setup.

## What it reports

For every commit on the pull request:

- **Signature state** — whether GitHub could cryptographically verify it.
- **Author attribution** — whether the account GitHub resolved the commit to
  is the pull request's author. A commit whose email never matched a GitHub
  account is *not* flagged; that's ordinary, and flagging it would make the
  check noise.
- **Disclosed AI assistance** — a `Co-Authored-By: Claude` (or Copilot, GPT,
  Gemini, …) trailer.

Disclosing AI assistance **does not lower the result**. It's reported because
whoever is paying for the work may want to know, but penalising the trailer
would just teach people to delete it — which destroys the signal for the
person who needed it.

Unsigned commits are **not** treated as a fault either. Most repositories
never enable signing. The check reports what can be proven and says plainly
what can't.

## Signed attestation (optional)

Set `attest: true` and the action asks REWORK for a signed, timestamped
attestation of the run:

```yaml
jobs:
  proof:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      id-token: write        # required for attestation
    steps:
      - uses: Reworkdigital-io/REWORK-Proof@v1
        with:
          attest: true
```

**There is still no API key.** The workflow mints a short-lived OIDC token
that proves, on GitHub's authority, which repository and workflow the run
belongs to. Nothing long-lived is stored in your repository settings, so
there's nothing to leak or rotate.

Only counts are sent — never your code, never commit messages.

The result is a [W3C Verifiable Credential][vc] as a compact JWT. Anyone can
verify it **offline** against REWORK's published key at
`https://api.reworkdigital.io/api/v1/proofs/credentials/jwks.json` — no call
back to REWORK, so it keeps working for a reader who has never heard of us.

An attestation failure never fails your build. The local result stands on its
own.

[vc]: https://www.w3.org/TR/vc-data-model-2.0/

### What the attestation does and does not claim

It states that GitHub vouched for this workflow run belonging to this
repository and commit, and records the authorship signals the run observed.

It is **not** a review of your code, a test of whether it works, or a
judgement of its quality. The credential says so in its own disclaimer.

## Inputs

| Input | Default | Description |
|---|---|---|
| `github-token` | `${{ github.token }}` | Used to read the PR's commits. Needs no extra permissions. |
| `attest` | `false` | Request a signed attestation. Requires `id-token: write`. |
| `api-url` | `https://api.reworkdigital.io/api/v1` | Override only for self-hosted REWORK. |
| `fail-on-unsigned` | `false` | Fail when any commit is unsigned. We recommend leaving this off. |

## Outputs

| Output | Description |
|---|---|
| `commits-total` | Commits examined. |
| `commits-signed` | How many carried a verifiable signature. |
| `commits-foreign` | Commits attributed to an account other than the PR author. |
| `ai-disclosed` | Commits whose message declares AI assistance. |
| `credential` | The signed VC-JWT, when `attest` is enabled. |

## Limits

The commit read stops at **300 commits**. A larger pull request is reported as
inconclusive rather than clean — a partial read that claimed "all verified"
would be the one failure mode that actively misleads.

## Implementation

One dependency-free Node file: [`src/main.js`](src/main.js). No bundled
`dist/`, no `node_modules`, no build step. What you read is what runs.

## Related

For automatic verification on every pull request without adding a workflow,
the [REWORK Proof GitHub App](https://github.com/apps/rework-proof) posts the
same result as a check run.

## Licence

MIT — see [LICENSE](LICENSE).
