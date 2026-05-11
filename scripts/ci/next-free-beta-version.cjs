#!/usr/bin/env node
/**
 * Print the next 1.1.0-beta.N semver such that refs/tags/v<that> does not exist locally
 * or on origin (avoids standard-version failing when a tag was pushed but develop was not).
 */
'use strict';

const { execSync } = require('child_process');
const fs = require('fs');
const semver = require('semver');

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));

function tagExists(tagName) {
  const ref = `refs/tags/${tagName}`;
  try {
    execSync(`git rev-parse -q --verify "${ref}"`, { stdio: 'ignore' });
    return true;
  } catch (_) {}
  try {
    const out = execSync(`git ls-remote origin "${ref}"`, { encoding: 'utf8' });
    return out.trim().length > 0;
  } catch {
    return false;
  }
}

let candidate = semver.inc(pkg.version, 'prerelease', 'beta');
if (!candidate) {
  throw new Error(`cannot bump prerelease from ${pkg.version}`);
}
let steps = 0;
while (tagExists(`v${candidate}`)) {
  if (++steps > 500) {
    throw new Error('too many occupied prerelease tags');
  }
  const next = semver.inc(candidate, 'prerelease', 'beta');
  if (!next || semver.eq(next, candidate)) {
    throw new Error(`stuck at ${candidate}`);
  }
  candidate = next;
}

process.stdout.write(candidate);
