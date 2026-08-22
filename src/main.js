#!/usr/bin/env node
/**
 * REWORK Proof Check — reports who actually wrote the commits in a PR.
 *
 * Zero dependencies on purpose. Node 20 ships global fetch, so this file is
 * the whole action: no package.json, no node_modules, no bundled dist/ that
 * drifts from its source. What you read is what runs in your CI.
 *
 * Default behaviour sends nothing anywhere. It reads the PR's commits with
 * the token the workflow already has and writes a job summary. Only when
 * `attest: true` does it talk to REWORK, and even then it sends counts, not
 * code — and authenticates with a short-lived OIDC token the workflow mints
 * for itself, so there is no API key to store, leak, or rotate.
 */

'use strict';

const fs = require('fs');

const MAX_PAGES = 3;
const PER_PAGE = 100;

// Mirrors the server-side detector so a commit reads the same either way.
const AI_TRAILER = /(Co-?Authored-?By:\s*(Claude|Copilot|GPT|ChatGPT|Gemini|Cursor|Devin|Codex)|Generated\s+(with|by)\s+\S+|🤖\s*Generated)/i;

function out(name, value) {
  const f = process.env.GITHUB_OUTPUT;
  if (!f) return;
  fs.appendFileSync(f, `${name}=${String(value).replace(/\n/g, ' ')}\n`);
}

function summary(md) {
  const f = process.env.GITHUB_STEP_SUMMARY;
  if (f) fs.appendFileSync(f, md + '\n');
  process.stdout.write(md + '\n');
}

function notice(msg) {
  process.stdout.write(`::notice::${msg}\n`);
}

function fail(msg) {
  process.stdout.write(`::error::${msg}\n`);
  process.exit(1);
}

async function gh(url, token) {
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'rework-proof-check',
    },
  });
  if (!res.ok) {
    throw new Error(`GitHub API ${res.status} for ${url}: ${(await res.text()).slice(0, 200)}`);
  }
  return res.json();
}

/** The OIDC token proving which repo this run belongs to. */
async function idToken(audience) {
  const url = process.env.ACTIONS_ID_TOKEN_REQUEST_URL;
  const rt = process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  if (!url || !rt) {
    throw new Error(
      'no OIDC token available — add `permissions: id-token: write` to the job'
    );
  }
  const res = await fetch(`${url}&audience=${encodeURIComponent(audience)}`, {
    headers: { Authorization: `Bearer ${rt}` },
  });
  if (!res.ok) throw new Error(`could not mint an OIDC token: ${res.status}`);
  return (await res.json()).value;
}

async function main() {
  const token = process.env.RP_GITHUB_TOKEN;
  const repo = process.env.RP_REPOSITORY;
  const apiServer = process.env.RP_API_SERVER || 'https://api.github.com';
  const attest = String(process.env.RP_ATTEST).toLowerCase() === 'true';
  const failUnsigned = String(process.env.RP_FAIL_ON_UNSIGNED).toLowerCase() === 'true';

  let event = {};
  try {
    event = JSON.parse(fs.readFileSync(process.env.RP_EVENT_PATH, 'utf8'));
  } catch {
    /* not every event carries a payload we can read */
  }

  const pr = event.pull_request;
  if (!pr || !pr.number) {
    // Not a mistake, and not worth failing a build over: the action simply
    // has nothing to look at outside a pull request.
    notice('REWORK Proof: not a pull request event — nothing to verify.');
    out('commits-total', 0);
    return;
  }

  const prAuthor = (pr.user && pr.user.login) || '';

  let commits = [];
  let truncated = false;
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const batch = await gh(
      `${apiServer}/repos/${repo}/pulls/${pr.number}/commits?per_page=${PER_PAGE}&page=${page}`,
      token
    );
    commits = commits.concat(batch);
    if (batch.length < PER_PAGE) break;
    if (page === MAX_PAGES) truncated = true;
  }

  let signed = 0;
  const foreign = [];
  const automation = [];
  const aiDisclosed = [];
  for (const c of commits) {
    const v = (c.commit && c.commit.verification) || {};
    if (v.verified) signed += 1;

    // A commit with no resolved GitHub account is ordinary — a local git
    // config that never matched an account. Only a *different* account is
    // worth surfacing. GitHub machine accounts end in "[bot]" — reserved
    // punctuation no human login can contain — and a dependabot bump is not
    // a co-author, so those are classed as automation, not foreign.
    const login = c.author && c.author.login;
    if (prAuthor && login && login.toLowerCase() !== prAuthor.toLowerCase()) {
      if (login.endsWith('[bot]')) {
        automation.push(`${c.sha.slice(0, 7)} (${login})`);
      } else {
        foreign.push(`${c.sha.slice(0, 7)} (${login})`);
      }
    }
    if (AI_TRAILER.test((c.commit && c.commit.message) || '')) {
      aiDisclosed.push(c.sha.slice(0, 7));
    }
  }

  const total = commits.length;
  out('commits-total', total);
  out('commits-signed', signed);
  out('commits-foreign', foreign.length);
  out('commits-automation', automation.length);
  out('ai-disclosed', aiDisclosed.length);

  const lines = ['## REWORK Proof', ''];
  lines.push(`**${signed} of ${total}** commit${total === 1 ? '' : 's'} carry a signature GitHub could verify.`);
  if (prAuthor) {
    if (foreign.length) {
      lines.push('', `**Authored by someone other than @${prAuthor}:** ${foreign.slice(0, 10).join(', ')}`);
      lines.push('', 'That is common and legitimate on a rebased or co-developed branch. It is shown because whoever is paying for this work may want to know.');
    } else if (automation.length) {
      lines.push('', `Every human-authored commit GitHub could resolve is attributed to **@${prAuthor}**.`);
    } else {
      lines.push('', `Every commit GitHub could resolve is attributed to **@${prAuthor}**.`);
    }
    if (automation.length) {
      lines.push('', `**Automation commits:** ${automation.slice(0, 10).join(', ')}`);
      lines.push('', 'Dependency bumps and workflow commits, listed separately from human co-authors. Routine on most repositories.');
    }
  }
  if (aiDisclosed.length) {
    lines.push('', `**AI assistance disclosed** in ${aiDisclosed.length} commit${aiDisclosed.length === 1 ? '' : 's'}: ${aiDisclosed.slice(0, 10).join(', ')}`);
    lines.push('', 'This does not lower the result. Declaring a co-author is good practice, and REWORK reports it rather than penalising it.');
  }
  if (truncated) {
    lines.push('', `**Only the first ${PER_PAGE * MAX_PAGES} commits were read.** This pull request is larger than that, so the result is inconclusive rather than clean.`);
  }
  if (signed < total) {
    lines.push('', `Signing is not required and unsigned commits are not a fault — most repositories never enable it. This reports what can be proven, and authorship of ${total - signed} unsigned commit${total - signed === 1 ? '' : 's'} cannot be proven from git history alone.`);
  }

  if (attest) {
    try {
      const audience = 'https://reworkdigital.io';
      const oidc = await idToken(audience);
      const res = await fetch(`${process.env.RP_API_URL}/github-app/attest`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${oidc}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          commits_total: total,
          commits_signed: signed,
          commits_foreign: foreign.length,
          ai_disclosed: aiDisclosed.length,
          truncated,
        }),
      });
      if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`);
      const body = await res.json();
      out('credential', body.credential || '');

      const ts = body.timestamp || {};
      out('timestamp-status', ts.status || 'unavailable');
      out('credential-sha256', ts.digest_sha256 || '');
      if (ts.ots_base64) out('ots-receipt', ts.ots_base64);

      lines.push('', '---', '', `Signed attestation issued. Verify it offline against [REWORK's public key](${body.verify_url}) — no call back to REWORK required.`);

      if (ts.status === 'submitted') {
        // "submitted", not "confirmed": the calendar has promised to include
        // this digest in its next Bitcoin batch, which lands roughly hourly.
        // Saying "anchored in Bitcoin" now would be a claim the receipt does
        // not yet support.
        lines.push('', `Timestamp submitted to OpenTimestamps via \`${ts.calendar}\`. `
          + `The receipt covers \`sha256:${(ts.digest_sha256 || '').slice(0, 16)}…\` and becomes `
          + `independently verifiable once the calendar's next Bitcoin batch confirms — `
          + `upgrade it any time with \`ots upgrade\`.`);
      } else {
        lines.push('', '_No timestamp: the OpenTimestamps calendars were unreachable. '
          + 'The credential is unaffected — it is signed and verifiable either way._');
      }
    } catch (err) {
      // An attestation failure must not fail somebody's build. The local
      // result above is complete and correct on its own.
      lines.push('', `_Attestation skipped: ${err.message}_`);
      process.stdout.write(`::warning::REWORK attestation skipped: ${err.message}\n`);
    }
  }

  // Someone who reached the Action first may actually want the App: it needs
  // no workflow file and covers every repo at once. Saying so here costs a
  // line and catches the people who arrived through the wrong door.
  lines.push('', '---', '',
    '<sub>Want this on every pull request without a workflow file? '
    + '[Install the REWORK Proof App](https://github.com/apps/rework-proof). '
    + 'Prefer granting no repository access at all? You are already in the right place.</sub>');

  summary(lines.join('\n'));

  if (failUnsigned && signed < total) {
    fail(`${total - signed} unsigned commit(s) and fail-on-unsigned is enabled.`);
  }
}

main().catch((err) => fail(`REWORK Proof failed: ${err.message}`));
