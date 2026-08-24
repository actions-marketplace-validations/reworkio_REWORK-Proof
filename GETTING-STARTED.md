# Getting started

Two ways to use REWORK Proof on a repository. They report the same thing and
you can run either, or both.

| | **Action** | **GitHub App** |
|---|---|---|
| What you add | one workflow file | nothing |
| What you grant | nothing | read access to the repo |
| Where the result appears | the workflow run's summary | a check on the pull request |
| Runs on | pull requests your workflow watches | every pull request, automatically |
| Works on forks' pull requests | yes | yes |

**Pick the Action if you'd rather grant nothing.** It reads the pull request
with the token your workflow already has, and by default sends nothing
anywhere.

**Pick the App if you'd rather add nothing.** No files, no workflow, and it
covers pull requests opened before anyone remembers to add CI.

---

## Path A — the Action

### 1. Create a branch on your repository

A brand-new repository is fine. It needs at least one commit on the default
branch so a pull request has something to target.

### 2. Add the workflow

Create `.github/workflows/proof.yml`:

```yaml
name: Proof
on: pull_request

permissions:
  contents: read
  pull-requests: read

jobs:
  proof:
    runs-on: ubuntu-latest
    steps:
      - uses: Reworkdigital-io/REWORK-Proof@v1
```

That's the whole setup — no token to create, no secret to store, no account.

The `permissions:` block is spelled out because some organisations default new
workflows to a restricted token. If yours doesn't, the action works without it.

Commit that file to your default branch, so it exists before the pull request
you want it to run on.

### 3. Open a pull request

Any branch with at least one commit. The workflow runs on `opened`,
`synchronize` and `reopened`.

### 4. Read the result

On the pull request → **Checks** → **Proof** → the job summary panel. You'll
get a short report: how many commits carried a verifiable signature, whether
any were authored by someone other than you, and whether any declared AI
assistance.

Nothing has left your repository at this point.

### 5. Optional — a signed attestation

If you want a portable artefact a client can verify without taking your word
for it, add `attest: true` and the `id-token` permission:

```yaml
name: Proof
on: pull_request

permissions:
  contents: read
  pull-requests: read
  id-token: write        # required for attestation

jobs:
  proof:
    runs-on: ubuntu-latest
    steps:
      - uses: Reworkdigital-io/REWORK-Proof@v1
        with:
          attest: true
```

Still no API key: the workflow mints a short-lived OIDC token that proves, on
GitHub's authority, which repository and run this is. **Only counts are sent
— never your code, never commit messages.** The result is a signed credential
anyone can verify offline against REWORK's published key.

If the attestation call fails, your build still passes. The local result stands
on its own.

One limit worth knowing: GitHub does not issue an OIDC token to a workflow
triggered by a pull request **from a fork**. The report still runs there; only
the attestation is skipped, harmlessly.

---

## Path B — the GitHub App

### 1. Install it

Go to **https://github.com/apps/rework-proof** and press **Install**.

### 2. Choose where it runs

Pick **Only select repositories** and choose the one you want. You can add
more later; you never have to grant it your whole account.

### 3. Read what it asks for

The install screen lists the permissions. It asks to *read* pull requests and
their commits, and to write **checks** — that last one is how the result
appears on the pull request. It does not ask for write access to your code.

### 4. Open a pull request

Nothing else to configure. Within a few seconds a check named **REWORK Proof**
appears on the pull request.

### 5. Read the result

The check's **Details** page carries the same report the Action produces.

### 6. Optional — per-repository configuration

Accounts ending in `[bot]` are classed as automation automatically. If your
repository also has a release or CI account that *doesn't* carry the `[bot]`
suffix, you can list it in `.github/rework-proof.yml`:

```yaml
# .github/rework-proof.yml
# Extra accounts to class as automation instead of human co-authors.
automation_authors:
  - my-release-bot
```

This only relabels: the commits stay listed (under "Automation commits"),
they still have to be signed for a green result, and the summary says when
this file did the classing. The App reads the file from your **default
branch** — a pull request editing it is still verified under the rules the
default branch had, so a PR can't write its own exemptions. No file means no
change to how the check behaves.

---

## Trying it properly

A pull request of ordinary commits only exercises one path. These four cover
the interesting ones:

```bash
git checkout -b proof-test

git commit --allow-empty -m "plain unsigned commit"

git commit --allow-empty -m "discloses AI assistance

Co-Authored-By: Claude <noreply@anthropic.com>"

# Author resolves to a real GitHub account that is a bot ("[bot]" suffix)
GIT_AUTHOR_NAME="github-actions[bot]" \
GIT_AUTHOR_EMAIL="41898282+github-actions[bot]@users.noreply.github.com" \
  git commit --allow-empty -m "authored by automation"

# Author email linked to no GitHub account at all
GIT_AUTHOR_NAME="Nobody" GIT_AUTHOR_EMAIL="nobody@example.invalid" \
  git commit --allow-empty -m "unresolvable author"

git push -u origin proof-test
```

Open the pull request and check four things:

| What to look for | Why it matters |
|---|---|
| The result is never a red ✗ | Most repositories don't sign commits. A failing check on an honest pull request is wrong. |
| The AI commit is named, but the result isn't lowered | Penalising the trailer would just teach people to delete it, destroying the signal for whoever needed it. |
| `github-actions[bot]` is listed under "Automation commits", not as a human co-author | Bot accounts end in `[bot]` — a dependency bump is routine, and listing it beside human co-authors would read as an accusation. |
| The **unresolvable** author is *not* listed there | A commit whose email never matched a GitHub account is ordinary. Treating it as an impostor would make the check noise. |

---

## If something doesn't appear

**No check run at all (App).** Confirm the App is installed on *that*
repository — installation is per-repository, not per-account. Check
**Settings → GitHub Apps → REWORK Proof → Configure**.

**The workflow didn't run (Action).** `proof.yml` has to exist on the branch
the pull request targets, not only on the branch it comes from. Commit it to
your default branch first.

**Result says "inconclusive".** The commit read stops at 300 commits. A larger
pull request is reported as inconclusive rather than clean — a partial read
claiming "all verified" is the one failure mode that actively misleads.

**Result is neutral, not success.** Neutral is the normal outcome whenever
anything is unproven: an unsigned commit, an unresolved author, a truncated
read. It is not a failure and it does not block a merge.

---

## Path C — joining a Hugging Face publication to its build

If your workflow trains or packages a model and pushes it to the Hugging
Face Hub, the action can tie the two together: a signed statement that the
exact bytes now on your HF repository came out of this run, from a
repository whose owner also holds the verified REWORK control claim on
that HF repo. Neither platform can make that statement alone.

Two one-time prerequisites, both on your own accounts:

1. Install and link the REWORK Proof App for the GitHub user or org that
   owns the workflow repository.
2. Complete REWORK's repo-control ceremony on the Hugging Face repository
   (Verification → Hugging Face on your REWORK profile).

Then add the action AFTER your own upload step — for example as
`.github/workflows/publish-model.yml`:

```yaml
name: Publish model

on:
  push:
    branches: [main]

permissions:
  contents: read
  id-token: write

jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      # Your real workflow checks out and builds first. Then YOUR OWN
      # publish step, with your own credentials - the action never uploads
      # and never holds a write token.
      - run: huggingface-cli upload <your-hf-owner>/<your-model> ./out
        env:
          HF_TOKEN: ${{ secrets.HF_WRITE_TOKEN }}

      - uses: Reworkdigital-io/REWORK-Proof@v1
        with:
          attest: true
          hf-repo: <your-hf-owner>/<your-model>
          hf-token: ${{ secrets.HF_READ_TOKEN }}   # READ-only; see below
```

`hf-token` is optional for public repositories but recommended: runners
share an anonymous rate limit, and a fine-grained token with read-only
content permission keeps the read steady. Never pass a write token — the
action has no use for one, by design.

What happens: the action reads your HF repository's current state and
digests its file inventory; REWORK then reads the repository again
*itself*, and only issues the credential when its own read reproduces the
digest and one REWORK account holds both sides. The result appears in the
job summary:

**Joined** — the signed credential is in the `hf-join-credential` output,
verifiable offline like every other attestation. The summary names the
workflow beside the verdict on purpose: the credential proves this run
*carried* these bytes, not what the run did to make them — a reader judges
that from the workflow itself.

**Unbound / mismatch / ambiguous** — neutral statuses, never failed
builds. Unbound means the two one-time steps above aren't complete under
one REWORK account; mismatch usually means the repo changed while being
read (re-run); ambiguous means this exact content is already recorded
under another repository, so no credential can say which publication it
belongs to.

---

## Verifying without trusting us

Attestations are signed with Ed25519 and REWORK's public key is published at
`https://api.reworkdigital.io/api/v1/proofs/credentials/jwks.json`. Any JOSE
library verifies one offline — no call to REWORK, no dependency on us
continuing to exist. That is the point of issuing them this way.

For AI agents, the same checks are available over MCP: see
[`mcp/`](mcp/).
