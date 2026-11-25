// Installs every tool under test into tools/<name>/, each in its own folder so versions don't collide.
// Every published OpenLint release from 1.0.0 is installed; other tools at their latest version.
//   node tools.mjs                 all
//   node tools.mjs openlint@1.3.0  just these
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const npmView = (pkg, field) => JSON.parse(execFileSync('npm', ['view', pkg, field, '--json'], { encoding: 'utf8' }));
const stable = v => /^\d+\.\d+\.\d+$/.test(v) && Number(v.split('.')[0]) >= 1;

export function toolList() {
  const list = npmView('openlint', 'versions').filter(stable).map(v => ({ name: `openlint@${v}`, pkg: `openlint@${v}`, bin: 'openlint', kind: 'spectral' }));
  list.push(
    { name: `spectral@${npmView('@stoplight/spectral-cli', 'version')}`, pkg: '@stoplight/spectral-cli@latest', bin: 'spectral', kind: 'spectral' },
    { name: `vacuum@${npmView('@quobix/vacuum', 'version')}`, pkg: '@quobix/vacuum@latest', bin: 'vacuum', kind: 'vacuum' },
    { name: `redocly@${npmView('@redocly/cli', 'version')}`, pkg: '@redocly/cli@latest', bin: 'redocly', kind: 'redocly' },
    { name: `ibm-openapi-validator@${npmView('ibm-openapi-validator', 'version')}`, pkg: 'ibm-openapi-validator@latest', bin: 'lint-openapi', kind: 'ibm' },
  );
  return list;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const only = process.argv.slice(2);
  const list = toolList().filter(t => !only.length || only.includes(t.name));
  for (const t of list) {
    const dir = `tools/${t.name}`;
    if (fs.existsSync(`${dir}/node_modules/.bin/${t.bin}`)) { console.log(t.name, 'present'); continue; }
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(`${dir}/package.json`, '{"private":true}');
    execFileSync('npm', ['i', '--no-audit', '--no-fund', '--silent', t.pkg], { cwd: dir, stdio: 'inherit' });
    console.log(t.name, 'installed');
  }
  fs.writeFileSync('tools/tools.json', JSON.stringify(list, null, 1));
}
