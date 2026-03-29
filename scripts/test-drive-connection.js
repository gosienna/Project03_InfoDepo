#!/usr/bin/env node
/**
 * test-drive-connection.js
 * Validates .env credentials and lists files in VITE_TEST_DRIVE_FOLDER_ID.
 * Run: npm run test:drive
 */

import fs from 'fs';
import https from 'https';

// ── Load .env ────────────────────────────────────────────────────────────────

function loadEnv(filePath = '.env') {
  const env = {};
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim();
      env[key] = val;
    }
  } catch {
    console.error('❌  Could not read .env file. Make sure it exists at the project root.');
    process.exit(1);
  }
  return env;
}

// ── Validate credentials ─────────────────────────────────────────────────────

function validate(env) {
  const errors = [];

  const folderId = env.VITE_TEST_DRIVE_FOLDER_ID;
  const clientId = env.VITE_TEST_CLIENT_ID;
  const apiKey   = env.VITE_TEST_API_KEY;

  if (!folderId) errors.push('VITE_TEST_DRIVE_FOLDER_ID is missing');
  if (!clientId) errors.push('VITE_TEST_CLIENT_ID is missing');
  if (!apiKey)   errors.push('VITE_TEST_API_KEY is missing');

  // Detect common credential mistakes
  if (apiKey && !apiKey.startsWith('AIza')) {
    if (apiKey.startsWith('GOCSPX-')) {
      errors.push(
        'VITE_TEST_API_KEY looks like an OAuth Client Secret (starts with GOCSPX-).\n' +
        '   → Go to Google Cloud Console → APIs & Services → Credentials\n' +
        '   → Create an API Key (not a Client Secret) and paste it here.\n' +
        '   → API Keys start with "AIza..."'
      );
    } else {
      errors.push('VITE_TEST_API_KEY does not look like a valid Google API Key (expected "AIza...")');
    }
  }

  if (clientId && !clientId.includes('.apps.googleusercontent.com')) {
    errors.push('VITE_TEST_CLIENT_ID does not look like a valid OAuth Client ID (expected "...apps.googleusercontent.com")');
  }

  if (clientId && clientId.includes('.apps.googleusercontent.com')) {
    const numericPrefix = clientId.split('-')[0];
    if (!/^\d+$/.test(numericPrefix)) {
      errors.push(
        'VITE_TEST_CLIENT_ID prefix is not numeric.\n' +
        '   → A valid Client ID looks like: 123456789012-xxxx.apps.googleusercontent.com'
      );
    }
  }

  return errors;
}

// ── Drive API call ───────────────────────────────────────────────────────────

function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(data) }));
    }).on('error', reject);
  });
}

async function listFiles(folderId, apiKey) {
  const query   = encodeURIComponent(`'${folderId}' in parents and trashed = false`);
  const fields  = encodeURIComponent('files(id,name,mimeType,size),nextPageToken');
  const url = `https://www.googleapis.com/drive/v3/files?q=${query}&fields=${fields}&key=${apiKey}`;
  return get(url);
}

// ── Format helpers ───────────────────────────────────────────────────────────

function formatSize(bytes) {
  if (!bytes) return '—';
  const n = parseInt(bytes);
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 ** 2).toFixed(1)} MB`;
}

function mimeLabel(mime) {
  const map = {
    'application/epub+zip': 'EPUB',
    'application/pdf': 'PDF',
    'text/plain': 'TXT',
  };
  return map[mime] ?? mime;
}

// ── Main ─────────────────────────────────────────────────────────────────────

const env    = loadEnv();
const errors = validate(env);

console.log('\n🔍  Google Drive Connection Test');
console.log('─'.repeat(48));
console.log(`  VITE_TEST_DRIVE_FOLDER_ID : ${env.VITE_TEST_DRIVE_FOLDER_ID || '(empty)'}`);
console.log(`  VITE_TEST_CLIENT_ID       : ${env.VITE_TEST_CLIENT_ID       || '(empty)'}`);
console.log(`  VITE_TEST_API_KEY         : ${env.VITE_TEST_API_KEY         || '(empty)'}`);
console.log('─'.repeat(48));

if (errors.length) {
  console.error('\n❌  Credential errors found:\n');
  errors.forEach((e, i) => console.error(`  ${i + 1}. ${e}\n`));
  process.exit(1);
}

console.log('\n✅  Credentials look valid. Connecting to Drive API...\n');

const { status, body } = await listFiles(env.VITE_TEST_DRIVE_FOLDER_ID, env.VITE_TEST_API_KEY);

if (status !== 200) {
  console.error(`❌  Drive API returned HTTP ${status}`);
  console.error(`    ${body.error?.message ?? JSON.stringify(body.error)}`);
  if (status === 403) {
    console.error('\n   Possible causes:');
    console.error('   • Google Drive API is not enabled for this API Key');
    console.error('   • API Key has HTTP referrer restrictions — remove them for server-side use');
    console.error('   • The folder is private and requires OAuth (API Key alone is not enough)');
  }
  if (status === 400) {
    console.error('\n   Possible causes:');
    console.error('   • VITE_TEST_DRIVE_FOLDER_ID is incorrect');
  }
  process.exit(1);
}

const files = body.files ?? [];
if (files.length === 0) {
  console.log('⚠️   Connected successfully, but no files found in the folder.');
  console.log('    Check that the folder ID is correct and contains files.');
  process.exit(0);
}

console.log(`✅  Connected. Found ${files.length} file(s) in test folder:\n`);
console.log('  ' + 'Name'.padEnd(45) + 'Type'.padEnd(8) + 'Size');
console.log('  ' + '─'.repeat(62));
for (const f of files) {
  const name = f.name.length > 43 ? f.name.slice(0, 40) + '...' : f.name;
  console.log(`  ${name.padEnd(45)}${mimeLabel(f.mimeType).padEnd(8)}${formatSize(f.size)}`);
}
console.log();
