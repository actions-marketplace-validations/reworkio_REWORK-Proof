#!/usr/bin/env node
/**
 * REWORK Proof — an MCP server for checking whether delivered work is genuine.
 *
 * The audience is an AI agent that has been handed a pull request, a
 * contractor's portfolio, or a credential, and needs to answer "is this
 * actually theirs?" without taking anyone's word for it.
 *
 * ZERO DEPENDENCIES, DELIBERATELY. MCP's stdio transport is newline-delimited
 * JSON-RPC 2.0, which is small enough to implement outright. A tool whose
 * entire purpose is verifying authenticity has no business asking you to
 * trust ninety transitive packages first - the supply chain is part of the
 * claim. Node 20's global fetch covers the rest.
 *
 * THE ONE RULE OF STDIO TRANSPORT: stdout carries protocol frames and nothing
 * else. A stray console.log corrupts the stream and the client disconnects
 * with an unhelpful parse error, so every diagnostic here goes to stderr.
 */

'use strict';

const crypto = require('node:crypto');

const API = (process.env.REWORK_API_URL || 'https://api.reworkdigital.io/api/v1').replace(/\/$/, '');
const SERVER_VERSION = '1.0.0';

// Protocol revisions this server understands. We echo the client's if we know
// it, otherwise answer with our newest and let the client decide.
const SUPPORTED_PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const HTTP_TIMEOUT_MS = 15000;

const log = (...a) => process.stderr.write(a.join(' ') + '\n');

/**
 * What REWORK's assurance levels mean, and — more importantly — what they do
 * not. Held locally rather than fetched: an agent asking "how much does this
 * prove?" should get the same answer when the API is unreachable, and the
 * honest ceiling on a claim is not something to look up over the network.
 */
const ASSURANCE = {
  'workflow-identity': {
    means:
      'GitHub cryptographically vouched that a specific workflow run belongs to a '
      + 'specific repository and commit, and REWORK recorded the authorship signals '
      + 'that run observed (commit signature state, whether commits resolve to the '
      + 'PR author, disclosed AI assistance).',
    does_not_mean:
      'Nobody reviewed the code, ran it, or judged its quality. It does not say the '
      + 'work is good, only who the git history says wrote it.',
    strength: 'moderate — strong on identity, silent on quality',
  },
  'reviewed-reference': {
    means:
      'A REWORK reviewer watched a demonstration video and confirmed it corresponds '
      + 'to the claimed work, and the video is fingerprinted so reuse is detectable.',
    does_not_mean:
      'The reviewer did not audit the source, reproduce the result, or verify claims '
      + 'made verbally in the video.',
    strength: 'moderate — human-checked, but of a demonstration rather than the artefact',
  },
};

const CREDENTIAL_TYPES = {
  REWORKWorkflowAttestation: 'A CI run whose repository identity GitHub attested via OIDC.',
  REWORKProofOfWorkCredential: 'A submitted piece of work that passed REWORK verification.',
  REWORKVideoProvenanceReceipt: 'A reviewed demonstration video, fingerprinted against reuse.',
  REWORKReputationPassport: "A holder's full verified history in one signed credential.",
  REWORKReputationSummary: 'A summary of already-public verified facts about a holder.',
};

// ── tools ──────────────────────────────────────────────────────────────────

const TOOLS = [
  {
    name: 'verify_rework_credential',
    description:
      'Check whether a REWORK Verifiable Credential (a VC-JWT) is authentic, and '
      + 'report what it claims. Use this when someone presents a credential as '
      + 'evidence that they produced a piece of work. Returns whether the signature '
      + 'is valid, who issued it, and the credential subject.',
    inputSchema: {
      type: 'object',
      properties: {
        credential: {
          type: 'string',
          description: 'The compact VC-JWT, three base64url segments separated by dots.',
        },
      },
      required: ['credential'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_rework_issuer_keys',
    description:
      "Fetch REWORK's public signing keys (JWKS). Use this to verify a credential "
      + 'offline yourself instead of trusting this server, or to confirm the issuer '
      + 'key a credential names actually belongs to REWORK.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'explain_rework_assurance',
    description:
      'Explain what a REWORK assurance level or credential type proves, and what it '
      + 'explicitly does not prove. Use this before relying on a credential, so a '
      + 'weak claim is not read as a strong one.',
    inputSchema: {
      type: 'object',
      properties: {
        assurance: {
          type: 'string',
          description: 'Assurance level, e.g. "workflow-identity". Omit to list all.',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'lookup_rework_attestation',
    description:
      'Check whether REWORK actually ISSUED a credential - not just whether its '
      + 'signature verifies. A forged-but-well-formed token fails this; a real one '
      + 'returns its issuance record and the CURRENT OpenTimestamps receipt, which '
      + 'may have been upgraded to a Bitcoin confirmation since issue. Pass the '
      + 'credential (its sha256 is the lookup key) or the digest directly.',
    inputSchema: {
      type: 'object',
      properties: {
        credential: {
          type: 'string',
          description: 'The VC-JWT. Hashed locally; never sent anywhere.',
        },
        digest: {
          type: 'string',
          description: 'sha256 hex of the credential, if you already have it.',
        },
      },
      additionalProperties: false,
    },
  },
];

async function http(path, { method = 'GET', body } = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), HTTP_TIMEOUT_MS);
  try {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal: ctl.signal,
    });
    const text = await res.text();
    let parsed;
    try { parsed = JSON.parse(text); } catch { parsed = { raw: text.slice(0, 500) }; }
    if (!res.ok) throw new Error(`REWORK API ${res.status}: ${JSON.stringify(parsed).slice(0, 300)}`);
    return parsed;
  } finally {
    clearTimeout(timer);
  }
}

async function callTool(name, args) {
  if (name === 'verify_rework_credential') {
    const credential = (args && args.credential) || '';
    if (!credential.trim()) throw new Error('credential is required');
    const res = await http('/proofs/credentials/verify', {
      method: 'POST',
      body: { credential },
    });
    const subject = res.credential_subject || {};
    const assurance = subject.assurance;
    return {
      valid: res.valid === true,
      reason: res.reason || null,
      issuer: res.issuer || null,
      credential_subject: subject,
      // An agent that only reads `valid` would treat every credential as
      // equally strong. Ship the ceiling alongside the verdict.
      assurance_note: assurance && ASSURANCE[assurance]
        ? ASSURANCE[assurance].does_not_mean
        : 'Assurance level not recognised — do not assume this proves more than it states.',
    };
  }

  if (name === 'get_rework_issuer_keys') {
    return await http('/proofs/credentials/jwks.json');
  }

  if (name === 'explain_rework_assurance') {
    const level = args && args.assurance;
    if (level) {
      const entry = ASSURANCE[level];
      if (!entry) {
        return { error: `unknown assurance level: ${level}`, known: Object.keys(ASSURANCE) };
      }
      return { assurance: level, ...entry };
    }
    return { assurance_levels: ASSURANCE, credential_types: CREDENTIAL_TYPES };
  }

  if (name === 'lookup_rework_attestation') {
    let digest = args && args.digest;
    if (!digest && args && args.credential) {
      // Hashed locally: the credential itself never leaves this process.
      digest = crypto.createHash('sha256').update(args.credential, 'utf8').digest('hex');
    }
    if (!digest || !/^[0-9a-f]{64}$/.test(String(digest).toLowerCase())) {
      throw new Error('pass either `credential` (the VC-JWT) or `digest` (64 hex chars)');
    }
    digest = String(digest).toLowerCase();
    try {
      const record = await http(`/github-app/attestations/${digest}`);
      return {
        ...record,
        assurance_note:
          'Issuance confirms REWORK signed a credential with this digest. It is '
          + 'still not a review of the code or a claim the work is any good - '
          + 'and a "submitted" timestamp is a calendar promise, only "confirmed" '
          + 'means anchored in Bitcoin.',
      };
    } catch (err) {
      if (String(err.message).includes('REWORK API 404')) {
        return {
          issued: false,
          digest_sha256: digest,
          assurance_note:
            'REWORK has no record of issuing a credential with this digest. A '
            + 'valid signature with no issuance record deserves suspicion: it '
            + 'could predate the registry, or it could be a key compromise.',
        };
      }
      throw err;
    }
  }

  throw new Error(`unknown tool: ${name}`);
}

// ── JSON-RPC plumbing ──────────────────────────────────────────────────────

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n');
}

function result(id, value) { send({ jsonrpc: '2.0', id, result: value }); }
function failure(id, code, message) { send({ jsonrpc: '2.0', id, error: { code, message } }); }

async function handle(msg) {
  const { id, method, params } = msg;

  // A notification has no id and must never be answered - replying to one is
  // a protocol violation the client reports as an unsolicited response.
  const isNotification = id === undefined || id === null;

  if (method === 'initialize') {
    const asked = params && params.protocolVersion;
    return result(id, {
      protocolVersion: SUPPORTED_PROTOCOLS.includes(asked) ? asked : SUPPORTED_PROTOCOLS[0],
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'rework-proof', version: SERVER_VERSION },
    });
  }

  if (method === 'notifications/initialized' || method === 'initialized') return;
  if (method === 'ping') return isNotification ? undefined : result(id, {});

  if (method === 'tools/list') {
    return result(id, { tools: TOOLS });
  }

  if (method === 'tools/call') {
    const name = params && params.name;
    try {
      const out = await callTool(name, (params && params.arguments) || {});
      return result(id, {
        content: [{ type: 'text', text: JSON.stringify(out, null, 2) }],
        isError: false,
      });
    } catch (err) {
      // A tool that fails is a result, not a transport error: the model needs
      // to see why so it can adapt, and a JSON-RPC error would hide it.
      return result(id, {
        content: [{ type: 'text', text: `Tool ${name} failed: ${err.message}` }],
        isError: true,
      });
    }
  }

  if (isNotification) return;
  return failure(id, -32601, `Method not found: ${method}`);
}

let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  let nl;
  while ((nl = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, nl).trim();
    buffer = buffer.slice(nl + 1);
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch (err) {
      log(`dropping unparseable frame: ${err.message}`);
      continue;
    }
    Promise.resolve(handle(msg)).catch((err) => {
      log(`handler error: ${err.stack || err.message}`);
      if (msg && msg.id !== undefined && msg.id !== null) {
        failure(msg.id, -32603, `Internal error: ${err.message}`);
      }
    });
  }
});

process.stdin.on('end', () => process.exit(0));
log(`rework-proof MCP server ready (api=${API})`);
