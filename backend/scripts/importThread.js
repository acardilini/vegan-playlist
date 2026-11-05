// Thread import CLI (the Reddit thread skill's script). Reads a JSON file of mentions extracted from a pasted thread,
// prints the overview (what is new, what we already have), and - only with --apply - writes the approved items:
// bands to Leads, named songs by known artists to To be processed, vegan claims to the admin-only thread_claims notes.
// DRY-RUN BY DEFAULT. Direct DB access (database/db.js); never the admin password or an HTTP call.
//
// Usage (from backend/):
//   node scripts/importThread.js --file <abs path to json>                       # overview only
//   node scripts/importThread.js --file <abs path> --apply [--skip 4,9] [--include 12]
const fs = require('fs');
const pool = require('../database/db');
const threadImport = require('../services/threadImport');

function arg(name) { const i = process.argv.indexOf(name); return i === -1 ? null : process.argv[i + 1]; }
const nums = (v) => (v ? v.split(',').map((x) => parseInt(x, 10)).filter(Number.isInteger) : []);

async function main() {
  const file = arg('--file');
  if (!file) throw new Error('Usage: node scripts/importThread.js --file <path to json> [--apply] [--skip 4,9] [--include 12]');
  const extracted = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!process.argv.includes('--apply')) {
    console.log(threadImport.formatOverview(await threadImport.plan(pool, extracted)));
    console.log('\nDry run - nothing written. Re-run with --apply to write.');
    return;
  }
  const { results } = await threadImport.apply(pool, extracted, { skip: nums(arg('--skip')), include: nums(arg('--include')) });
  for (const r of results) {
    if (r.error) console.log(`#${r.n} ${r.artist}: ERROR: ${r.error}`);
    else if (r.skipped) console.log(`#${r.n} ${r.artist}: skipped: ${r.skipped}`);
    else console.log(`#${r.n} ${r.artist}: ${r.lead ? `lead ${r.lead}, ` : ''}songs +${r.songsAdded} (held ${r.songsHeld}), claims +${r.claimsAdded}`);
  }
}

main()
  .catch((e) => { console.error(e.code === 'BAD_INPUT' ? `Bad input: ${e.message}` : `Failed: ${e.code || e.name}`); process.exitCode = 1; })
  .finally(() => pool.end());
