// Downloads every document in corpus.yaml at its pinned commit into corpus/<id>/.
// Documents stay in their providers' repos: nothing here is redistributed.
//   node fetch.mjs          download (skips documents already present)
//   node fetch.mjs --pin    update each ref to the latest commit that touched the file
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import YAML from 'yaml';

const corpusFile = 'corpus.yaml';
const doc = YAML.parseDocument(fs.readFileSync(corpusFile, 'utf8'));
const docs = doc.toJS().documents;
const headers = process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {};

async function gh(url) {
  const r = await fetch(`https://api.github.com/${url}`, { headers });
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.json();
}

if (process.argv.includes('--pin')) {
  for (const [i, d] of docs.entries()) {
    const [c] = await gh(`repos/${d.repo}/commits?path=${encodeURIComponent(d.path)}&per_page=1`);
    const meta = await gh(`repos/${d.repo}/contents/${d.path}?ref=${c.sha}`);
    doc.setIn(['documents', i, 'ref'], c.sha);
    doc.setIn(['documents', i, 'bytes'], meta.size);
    console.log(d.id, d.ref === c.sha ? 'unchanged' : `${d.ref.slice(0, 7)} -> ${c.sha.slice(0, 7)}`);
  }
  fs.writeFileSync(corpusFile, doc.toString());
  process.exit(0);
}

for (const d of docs) {
  const dir = path.join('corpus', d.id);
  const target = path.join(dir, d.path);
  if (fs.existsSync(target)) { console.log(d.id, 'present'); continue; }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  if (d.tree) {
    // A description split across files: fetch the repo at the pinned commit and keep the folder.
    const tgz = path.join(dir, 'repo.tgz');
    const r = await fetch(`https://codeload.github.com/${d.repo}/tar.gz/${d.ref}`);
    if (!r.ok) throw new Error(`${d.id}: ${r.status}`);
    fs.writeFileSync(tgz, Buffer.from(await r.arrayBuffer()));
    const top = `${d.repo.split('/')[1]}-${d.ref}`;
    execFileSync('tar', ['-xzf', tgz, '-C', dir, '--strip-components=1', `${top}/${d.tree}`]);
    fs.rmSync(tgz);
  } else {
    const r = await fetch(`https://raw.githubusercontent.com/${d.repo}/${d.ref}/${d.path}`);
    if (!r.ok) throw new Error(`${d.id}: ${r.status}`);
    fs.writeFileSync(target, Buffer.from(await r.arrayBuffer()));
  }
  console.log(d.id, fs.statSync(target).size, 'bytes');
}
