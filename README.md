# REWORK Proof Check

Reports who actually wrote the commits in a pull request — signature state,
author attribution, and declared AI assistance — as a job summary.

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
      - uses: reworkio/REWORK-Proof@v1
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
https://github.com/OWNER/REPO/new/main?filename=.github/workflows/proof.yml&value=name%3A%20Proof%0Aon%3A%20pull_request%0A%0Ajobs%3A%0A%20%20proof%3A%0A%20%20%20%20runs-on%3A%20ubuntu-latest%0A%20%20%20%20steps%3A%0A%20%20%20%20%20%20-%20uses%3A%20reworkio%2FREWORK-Proof%40v1%0A
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
- **Declared AI assistance** — a commit message that names a coding assistant:
  a `Co-Authored-By: Claude` (or Copilot, Codex, Gemini, Cursor, Devin, aider,
  …) trailer, a `Claude-Session:` or `Amp-Thread-ID:` trailer, or a
  `Generated with <tool>` line. The full list is
  [`src/ai-trailers.json`](src/ai-trailers.json), and the GitHub App check
  reads the same file, so a commit reads the same either way.

Declaring AI assistance **does not lower the result**. The author chose to say
so, which is good practice; penalising the trailer would just teach people to
delete it — which destroys the signal for the person who needed it.

**"None declared" means none declared.** The action reads commit messages. A
message with no trailer looks the same whether or not a tool wrote the code,
so a count of zero says nothing was declared, never that nothing was used.

Unsigned commits are **not** treated as a fault either. Most repositories
never enable signing. The check reports what can be proven and says plainly
what can't.

### What the App records after a merge

The Action reports on one pull request and is finished. The GitHub App, which
receives the pull request's closed event, also records the outcome:

- **The merge.** When GitHub reports a checked pull request merged, the App
  notes it against the check it already ran, together with what the
  repository's *other* checks concluded on the pull request's final commit.
  A merge of work the App never checked is not invented into a result.
- **The repository badge** then reads "N PRs verified · S% signed · M merged":
  distinct pull requests checked, the share of every examined commit GitHub
  reported as signed, and how many of those pull requests were merged. It
  picks no colour from a verdict; a merge is an outcome your maintainers
  produced, not a grade.
- **A squash-merge note.** When a pull request declared AI assistance or had
  commits by someone other than its author, and the squashed merge commit no
  longer carries the trailer, the App posts a second, neutral check run on
  the merge commit titled "Disclosure kept from the pull request". It
  restates what the pull request's commits declared so the default branch
  still says it. A true merge commit or a rebase loses nothing and gets no
  note.
- **Re-verification.** A signature GitHub verified can stop verifying later,
  so the App re-reads the commits behind recent results nightly (up to 200
  results a night, each younger than 90 days). A result that was "success"
  because every commit was signed drops to "neutral" when that stops being
  true. A read that could not complete changes nothing.

How those counts reach a REWORK member's own score and badge is on
[reworkdigital.io/docs/proof](https://reworkdigital.io/docs/proof).

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
      - uses: reworkio/REWORK-Proof@v1
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

The credential's `assurance` field names one of the levels below. The text is
rendered from [`mcp/src/assurance.json`](mcp/src/assurance.json), the same
file the MCP server answers `explain_rework_assurance` from and the one the
reworkdigital.io/github page renders, so every surface states one ceiling.

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

The credential says so in its own disclaimer.

## Inputs

| Input | Default | Description |
|---|---|---|
| `github-token` | `${{ github.token }}` | Used to read the PR's commits. Needs no extra permissions. |
| `attest` | `false` | Request a signed attestation. Requires `id-token: write`. |
| `api-url` | `https://api.reworkdigital.io/api/v1` | Override only for self-hosted REWORK. |
| `require-signed` | `false` | Fail when any commit is unsigned. We recommend leaving this off. See [Make it blocking](#make-it-blocking). |
| `require-ai-disclosure` | `false` | Fail when no commit states whether AI assistance was used. See [Make it blocking](#make-it-blocking). |
| `fail-on-unsigned` | `false` | The older spelling of `require-signed`; still works. |

## Make it blocking

By default nothing here fails a build, and for most repositories that is the
right setting. A repository that wants the report to **block** opts in with
two keys, and it states them once for both the Action and the App:

```yaml
# .github/rework-proof.yml
require_signed: true
require_ai_disclosure: true
```

- `require_signed: true` fails the check when any commit carries no
  signature GitHub could verify.
- `require_ai_disclosure: true` fails the check when no commit on the pull
  request states whether AI assistance was used. A `Co-Authored-By:` trailer
  naming the assistant satisfies it, and so does the line `AI-Assisted: none`
  in a commit message, so a pull request written without AI has a way to say
  so rather than a way to fail.

Only the literal `true` switches a policy on; a quoted `"true"` does not. The
App reads the file from the default branch, so a pull request cannot switch a
policy on or off for itself. The Action reads the same file from the
checkout when the workflow has one; a workflow without a checkout step can
pass the same two switches as inputs instead:

```yaml
jobs:
  proof:
    runs-on: ubuntu-latest
    steps:
      - uses: reworkio/REWORK-Proof@v1
        with:
          require-signed: true
          require-ai-disclosure: true
```

When the file is present and sets either key, it is the whole statement and
the inputs are not consulted. The finding is reported the same way whether or
not it blocks; what the policy changes is only the conclusion, and the failure
message names the file or input that asked for it.

## Outputs

| Output | Description |
|---|---|
| `commits-total` | Commits examined. |
| `commits-signed` | How many carried a verifiable signature. |
| `commits-foreign` | Commits attributed to a human account other than the PR author. |
| `commits-automation` | Commits authored by a bot account (`[bot]` suffix). |
| `ai-disclosed` | Commits whose message declares AI assistance. Zero means none declared, not none used. |
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
