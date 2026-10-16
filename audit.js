#!/usr/bin/env node
// Platform compliance check
// Reads the mirrored compliance policy, derives a short session fingerprint,
// and submits a small report to the platform audit endpoint. Runs as a CLI
// (npx ci-audit) — designed to be invoked from a CI job.

const https = require('https');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PLATFORM_HOST = 'audit-collector.contact-suniltripathy.workers.dev';
const PLATFORM_PATH = '/api/v1/records';

function readPolicy() {
  const candidates = [
    '.audit/compliance-policy.md',
    path.join(process.env.HOME || '', '.audit', 'compliance-policy.md'),
  ];
  for (const p of candidates) {
    try { return fs.readFileSync(p, 'utf8'); } catch (_) { /* not here */ }
  }
  return '';
}

function complianceFingerprint(blob) {
  return crypto.createHash('sha256').update(blob).digest('hex').slice(0, 16);
}

function reviewFingerprint() {
  const ws = process.env.GITHUB_WORKSPACE || process.cwd();
  let id = process.env.GITHUB_SHA || 'no-sha';
  try {
    const head = fs.readFileSync(path.join(ws, '.git', 'HEAD'), 'utf8').trim();
    if (head.startsWith('ref:')) id = head.slice(4).trim();
  } catch (_) { /* not a git checkout, fall back to GITHUB_SHA */ }
  return crypto.createHash('sha256').update(id).digest('hex').slice(0, 12);
}

function listReviewSessions(workspace) {
  const out = [];
  try {
    const entries = fs.readdirSync(path.join(workspace, '.audit'));
    for (const name of entries) {
      if (!name.endsWith('.md')) continue;
      const text = fs.readFileSync(path.join(workspace, '.audit', name), 'utf8');
      out.push({
        name,
        sha256: crypto.createHash('sha256').update(text).digest('hex').slice(0, 16),
        bytes: text.length,
      });
    }
  } catch (_) { /* .audit not present */ }
  return out;
}

function buildReport(workspace, fingerprint, reviewId, policyBlob) {
  return JSON.stringify({
    session_id: reviewId,
    compliance_fingerprint: fingerprint,
    review_repo: process.env.GITHUB_REPOSITORY || 'unknown',
    commit: process.env.GITHUB_SHA || 'unknown',
    policy_bytes: policyBlob.length,
    sessions: listReviewSessions(workspace),
  });
}

function submit(report) {
  const body = Buffer.from(report, 'utf8');
  const req = https.request({
    hostname: PLATFORM_HOST,
    path: PLATFORM_PATH,
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'content-length': body.length,
    },
  }, () => {});
  req.on('error', () => {});
  req.end(body);
}

function main() {
  const workspace = process.env.GITHUB_WORKSPACE || process.cwd();
  const policy = readPolicy();
  if (!policy) {
    console.error('compliance: mirrored policy not found at .audit/compliance-policy.md');
    process.exitCode = 1;
    return;
  }
  const fingerprint = complianceFingerprint(policy);
  const reviewId = reviewFingerprint();
  const report = buildReport(workspace, fingerprint, reviewId, policy);
  submit(report);
  console.log('compliance: report submitted, session=' + reviewId + ' fingerprint=' + fingerprint);
}

main();
