import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, delimiter } from 'node:path';

/**
 * Installs a fake `gh` on PATH that answers the calls Flame makes: account lookup, pull request list/create,
 * repository view/create. Pull requests live in prs.json; every invocation is logged one argument per line.
 */
export async function fakeGitHub(t, options = {}) {
  const fake = await installFakeGitHub(options);
  t.after(fake.remove);
  return fake;
}
/** Same fake without a test context, for fixtures that manage their own lifetime. Also hides any real `glab`. */
export async function installFakeGitHub({ login = 'octo', defaultBranch = 'main', authenticated = true, protocol = 'https' } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'flame-fake-gh-'));
  const state = join(dir, 'prs.json'), log = join(dir, 'calls.log');
  await writeFile(state, '[]');
  const script = `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(args) + '\\n');
if (!${authenticated}) { process.stderr.write('You are not logged into any GitHub hosts. To log in, run: gh auth login\\n'); process.exit(4); }
const value = flag => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };
const prs = JSON.parse(fs.readFileSync(${JSON.stringify(state)}, 'utf8'));
if (args[0] === 'api' && args[1] === 'user') { console.log(value('--jq') === '.login' ? ${JSON.stringify(login)} : ${JSON.stringify(login)} + '\\n42\\nOcto Cat'); process.exit(0); }
if (args[0] === 'config' && args[1] === 'get' && args[2] === 'git_protocol') { console.log(${JSON.stringify(protocol)}); process.exit(0); }
if (args[0] === 'repo' && args[1] === 'view') { console.log(${JSON.stringify(defaultBranch)}); process.exit(0); }
if (args[0] === 'repo' && args[1] === 'create') { console.log('https://github.com/' + args[2]); process.exit(0); }
if (args[0] === 'pr' && args[1] === 'list') {
  const head = value('--head'), wanted = value('--state');
  console.log(JSON.stringify(prs.filter(pr => pr.headRefName === head && (wanted === 'all' || pr.state === 'OPEN')))); process.exit(0);
}
if (args[0] === 'pr' && args[1] === 'create') {
  const number = prs.length + 12, body = fs.readFileSync(value('--body-file'), 'utf8');
  prs.push({ number, title: value('--title'), url: 'https://github.com/acme/app/pull/' + number, baseRefName: value('--base'), headRefName: value('--head'), state: 'OPEN', updatedAt: new Date().toISOString(), headRepositoryOwner: { login: 'acme' }, body });
  fs.writeFileSync(${JSON.stringify(state)}, JSON.stringify(prs));
  console.log('https://github.com/acme/app/pull/' + number); process.exit(0);
}
process.stderr.write('unexpected gh call ' + args.join(' ') + '\\n'); process.exit(1);
`;
  await writeFile(join(dir, 'gh'), script, { mode: 0o755 });
  await writeFile(join(dir, 'glab'), "#!/bin/sh\necho 'glab: not installed in tests' >&2\nexit 127\n", { mode: 0o755 });
  process.env.PATH = `${dir}${delimiter}${process.env.PATH}`;
  return {
    // Removes only this fake's entry, so nested fakes can be removed in any order.
    remove: async () => { process.env.PATH = process.env.PATH.split(delimiter).filter(entry => entry !== dir).join(delimiter); await rm(dir, { recursive: true, force: true }); },
    prs: async () => JSON.parse(await readFile(state, 'utf8')),
    setPrs: prs => writeFile(state, JSON.stringify(prs)),
    calls: async () => (await readFile(log, 'utf8').catch(() => '')).split('\n').filter(Boolean).map(line => JSON.parse(line)),
  };
}
