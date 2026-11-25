// Times every tool on every document in corpus.yaml.
//   node run.mjs                                   everything
//   node run.mjs --tools openlint@1.3.0 --docs petstore,stripe   a subset (not published)
//   node run.mjs --runs 3                          repeat count for every document (default: by size tier)
// Writes results/runs/<timestamp>.json; a full run also writes results/latest.json and appends results/history.jsonl.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import YAML from 'yaml';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > -1 ? process.argv[i + 1] : d; };
const pick = (list, key, sel) => sel ? list.filter(x => sel.split(',').includes(x[key])) : list;

const RULESET = 'rulesets/spectral-oas.yaml';
const TIMEOUT_MS = Number(arg('timeout', 600)) * 1000;
const REPEATS = { xs: 5, s: 5, m: 5, l: 3, xl: 3 };   // timed runs per document, after one untimed warm-up
const docs = pick(YAML.parse(fs.readFileSync('corpus.yaml', 'utf8')).documents, 'id', arg('docs'));
const tools = pick(JSON.parse(fs.readFileSync('tools/tools.json', 'utf8')), 'name', arg('tools'));
const TMP = path.resolve('.tmp');
fs.mkdirSync(TMP, { recursive: true });

// The command for each kind of tool. Output goes to a file, so writing to the terminal isn't timed.
function command(t, doc) {
  const bin = path.resolve(`tools/${t.name}/node_modules/.bin/${t.bin}`);
  const out = path.join(TMP, 'out.json');
  switch (t.kind) {
    case 'spectral': return { bin, args: ['lint', doc, '-r', RULESET, '-f', 'json', '-o', out, '-q'], out };
    case 'vacuum': return { bin, args: ['spectral-report', '-r', RULESET, doc, out], out };
    case 'ibm': return { bin, args: ['-r', RULESET, '--json', doc], out, stdout: true };
    case 'redocly': return { bin, args: ['lint', doc, '--format=json'], out, stdout: true };
  }
}

function problems(kind, text) {
  try {
    const j = JSON.parse(text);
    if (kind === 'redocly') return j.totals.errors + j.totals.warnings;
    if (kind === 'ibm') return ['error', 'warning', 'info', 'hint'].reduce((n, k) => n + (j[k]?.summary?.total ?? 0), 0);
    return j.length;
  } catch { return null; }
}

// Peak memory comes from /usr/bin/time: -l on macOS (bytes), -v on Linux (kilobytes).
const mac = os.platform() === 'darwin';
function once(t, doc) {
  const c = command(t, doc);
  fs.rmSync(c.out, { force: true });
  return new Promise(resolve => {
    const fd = c.stdout ? fs.openSync(c.out, 'w') : 'ignore';
    const start = process.hrtime.bigint();
    const p = spawn('/usr/bin/time', [mac ? '-l' : '-v', c.bin, ...c.args], { stdio: ['ignore', fd, 'pipe'] });
    let err = '';
    p.stderr.on('data', d => { err += d; });
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; p.kill('SIGKILL'); }, TIMEOUT_MS);
    p.on('close', code => {
      clearTimeout(timer);
      if (typeof fd === 'number') fs.closeSync(fd);
      const ms = Number(process.hrtime.bigint() - start) / 1e6;
      const rss = mac ? err.match(/(\d+)\s+maximum resident set size/) : err.match(/Maximum resident set size \(kbytes\): (\d+)/);
      const rssMb = rss ? Number(rss[1]) / (mac ? 1048576 : 1024) : null;
      const text = fs.existsSync(c.out) ? fs.readFileSync(c.out, 'utf8') : '';
      const n = timedOut ? null : problems(t.kind, text);
      resolve({ ms, rssMb, exit: code, problems: n, status: timedOut ? 'timeout' : n === null ? 'error' : 'ok', stderr: n === null ? err.slice(-400) : undefined });
    });
  });
}

// The tool's own error lines, without /usr/bin/time's resource report or Node warnings.
const reason = (err = '') => err.split('\n').filter(l => /error|invalid|unsupported|cannot|failed/i.test(l) && !/resident|instructions|cycles|footprint|Deprecation/.test(l)).slice(0, 3).join(' ').replace(/\s+/g, ' ').trim() || null;

const median = a => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const round = (x, d = 0) => x == null ? null : Math.round(x * 10 ** d) / 10 ** d;

const results = [];
for (const d of docs) {
  const doc = path.resolve('corpus', d.id, d.path);
  for (const t of tools) {
    const warm = await once(t, doc);
    const r = { doc: d.id, tool: t.name };
    if (warm.status !== 'ok') {
      Object.assign(r, { status: warm.status, exit: warm.exit, ms: round(warm.ms), detail: reason(warm.stderr) });
    } else {
      const runs = [];
      for (let i = 0; i < (Number(arg('runs')) || REPEATS[d.tier]); i++) runs.push(await once(t, doc));
      const ok = runs.filter(x => x.status === 'ok');
      Object.assign(r, {
        status: ok.length === runs.length ? 'ok' : 'flaky',
        median_ms: round(median(ok.map(x => x.ms))), min_ms: round(Math.min(...ok.map(x => x.ms))), max_ms: round(Math.max(...ok.map(x => x.ms))),
        peak_mb: round(Math.max(...ok.map(x => x.rssMb ?? 0)), 1), problems: ok[0]?.problems, runs: ok.length,
      });
    }
    results.push(r);
    console.log(d.id.padEnd(15), t.name.padEnd(30), r.median_ms != null ? `${String(r.median_ms).padStart(7)} ms  ${String(r.peak_mb).padStart(7)} MB  ${r.problems} problems` : `${r.status} ${r.detail ?? ''}`);
  }
}

const run = {
  date: new Date().toISOString(),
  runner: { os: `${os.platform()} ${os.release()}`, cpu: os.cpus()[0].model, cores: os.cpus().length, memory_gb: round(os.totalmem() / 2 ** 30), node: process.version, ci: !!process.env.CI },
  ruleset: RULESET,
  documents: docs.map(({ id, provider, repo, path: p, ref, openapi, tier, bytes }) => ({ id, provider, repo, path: p, ref, openapi, tier, bytes })),
  tools: tools.map(t => t.name),
  results,
};
fs.mkdirSync('results/runs', { recursive: true });
fs.writeFileSync(`results/runs/${run.date.slice(0, 19).replace(/:/g, '-')}.json`, JSON.stringify(run, null, 1));
if (!arg('docs') && !arg('tools') && !arg('runs')) {   // only full runs become the published result and history
  fs.writeFileSync('results/latest.json', JSON.stringify(run, null, 1));
  const lines = results.filter(r => r.median_ms != null).map(r => JSON.stringify({ date: run.date, ci: run.runner.ci, doc: r.doc, tool: r.tool, median_ms: r.median_ms, peak_mb: r.peak_mb, problems: r.problems }));
  fs.appendFileSync('results/history.jsonl', lines.join('\n') + '\n');
}
