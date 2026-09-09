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

**New here?** [**GETTING-STARTED.md**](GETTING-STARTED.md) walks a fresh
repository through both this action and the GitHub App — which to choose, what
each one grants, and a set of commits that exercise every case so you can see
what the report actually does before trusting it.

### One-click setup

Replace `OWNER/REPO` with your own and open this — GitHub's editor opens with
the workflow already written, and you just press **Commit**:

```
https://github.com/OWNER/REPO/new/main?filename=.github/workflows/proof.yml&value=name%3A%20Proof%0Aon%3A%20pull_request%0A%0Ajobs%3A%0A%20%20proof%3A%0A%20%20%20%20runs-on%3A%20ubuntu-latest%0A%20%20%20%20steps%3A%0A%20%20%20%20%20%20-%20uses%3A%20Reworkdigital-io%2FREWORK-Proof%40v1%0A
```

If your default branch isn't `main`, change the `/new/main` segment to match.

## What it reports

For every commit on the pull request:

- **Signature state** — whether GitHub could cryptographically verify it.
- **Author attribution** — whether the account GitHub resolved the commit to
  is the pull request's author. A commit whose email never matched a GitHub
  account is *not* flagged; that's ordinary, and flagging it would make the
  check noise. Bot accounts (a `[bot]` suffix — dependabot, github-actions)
  are classed as automation, listed separately from human co-authors.
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
| `commits-foreign` | Commits attributed to a human account other than the PR author. |
| `commits-automation` | Commits authored by a bot account (`[bot]` suffix). |
| `ai-disclosed` | Commits whose message declares AI assistance. |
| `credential` | The signed VC-JWT, when `attest` is enabled. |

## Limits

The commit read stops at **300 commits**. A larger pull request is reported as
inconclusive rather than clean — a partial read that claimed "all verified"
would be the one failure mode that actively misleads.

## A proof that points here does not stay verified on its own

The Action reports on one pull request and is finished. A REWORK **proof**
that cites a GitHub repository is different: it is re-observed, and it decays
if the repository is later deleted, made private, transferred, or blocked,
rather than reading "verified" against evidence nobody can open any more.

The narrow rules matter more than the sweep:

- a **rename by the same owner is followed**, not punished, because the work
  is untouched
- **outages, timeouts and rate limits decay nothing** — those are our problem
- **two consecutive definitive failures** are required before anything is
  withdrawn

The re-check reads the repository anonymously on purpose. Verification ran on
the author's own token; the question afterwards is whether a *buyer* can still
open the evidence.

## Where the check's Details link goes

App only, and it is restrictive by design. A check run is public and sits on
someone else's pull request, so linking it to a REWORK profile is an identity
claim made in front of their colleagues. It is made only when **both ends are
verified**: GitHub told us which account installed the App, and that account
signed in to REWORK through the setup link. Anything less links to the public
proofs page and the summary carries an invitation, which claims nothing.

A self-typed profile field is never consulted. Trusting one would let anyone
advertise on a stranger's pull requests.

## Implementation

One dependency-free Node file: [`src/main.js`](src/main.js). No bundled
`dist/`, no `node_modules`, no build step. What you read is what runs.

## Related

For automatic verification on every pull request without adding a workflow,
the [REWORK Proof GitHub App](https://github.com/apps/rework-proof) posts the
same result as a check run.

- [GETTING-STARTED.md](GETTING-STARTED.md) — the Action, the App, and joining a
  Hugging Face publication to the build that produced it
- [reworkdigital.io/github](https://reworkdigital.io/github) — what the GitHub
  side checks and what it deliberately does not claim
- [reworkdigital.io/huggingface](https://reworkdigital.io/huggingface) — the
  Hub side: the control ceremony, and the reproducible evaluation REWORK runs
  itself rather than taking a download count's word for it
- [mcp/](mcp/) — the same checks over MCP, for AI agents

## Licence

MIT — see [LICENSE](LICENSE).
