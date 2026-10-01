import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gitCommand } from '../dist/backend/git/command.js';
import { repositoryStatus } from '../dist/backend/git/status.js';
import { parseNumstat, addedFileStats } from '../dist/backend/git/stats.js';

async function repository(t) {
  const root=await mkdtemp(join(tmpdir(),'flame-git-stats-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  await gitCommand(root,['init','--initial-branch=main']);
  await gitCommand(root,['config','user.name','Tests']);
  await gitCommand(root,['config','user.email','tests@example.invalid']);
  await gitCommand(root,['config','commit.gpgSign','false']);
  return root;
}
test('NUL numstat parsing preserves tabs/newlines, rename destinations and binary markers',()=>{
  assert.deepEqual([...parseNumstat('2\t1\twhite\tspace\n.ts\0-\t-\tbinary\0'+'1\t3\t\0old\nname\0new\tname\0')],[
    ['white\tspace\n.ts',{additions:2,deletions:1}],['binary',{additions:null,deletions:null}],['new\tname',{additions:1,deletions:3}],
  ]);
  for(const malformed of ['1\t2\t\0old\0','x\t2\tfile\0','-\t2\tfile\0','9007199254740992\t0\tfile\0','missing tabs\0']) assert.throws(()=>parseNumstat(malformed));
});
test('new-file statistics count logical lines without inventing a trailing line',()=>{
  for(const [source,count] of [['',0],['one',1],['one\n',1],['one\r\ntwo\r\n',2],['\n\n',2],['\ufeffone\r\ntwo',2]]) assert.deepEqual(addedFileStats(Buffer.from(source)),{additions:count,deletions:0});
  for(const bytes of [Buffer.from([0,1]),Buffer.from([255])]) assert.deepEqual(addedFileStats(bytes),{additions:null,deletions:null});
});
test('status returns separate real staged and working counts, including untracked and binary source',async t=>{
  const root=await repository(t);
  await writeFile(join(root,'changes.ts'),'one\ntwo\nthree\n');
  await writeFile(join(root,'delete.txt'),'delete\nthese\n');
  await writeFile(join(root,'binary'),Buffer.from([0,1]));
  await gitCommand(root,['add','--all']);await gitCommand(root,['commit','-m','Baseline']);
  await writeFile(join(root,'changes.ts'),'one\nTWO\nthree\nfour\n');await gitCommand(root,['add','--','changes.ts']);
  await writeFile(join(root,'changes.ts'),'one\nTWO\nfive\n');await rm(join(root,'delete.txt'));
  await writeFile(join(root,'binary'),Buffer.from([0,2]));
  await writeFile(join(root,'new\tline\n.ts'),'one\ntwo');await writeFile(join(root,'new-binary'),Buffer.from([255]));
  await symlink('/etc/passwd',join(root,'link'));
  // Stats must never execute configured external diff or textconv commands.
  await gitCommand(root,['config','diff.external','false']);
  const status=await repositoryStatus('test',root,undefined,true),byPath=new Map(status.files.map(file=>[file.path,file]));
  assert.deepEqual(byPath.get('changes.ts').stagedStats,{additions:2,deletions:1});
  assert.deepEqual(byPath.get('changes.ts').workingStats,{additions:1,deletions:2});
  assert.deepEqual(byPath.get('delete.txt').workingStats,{additions:0,deletions:2});
  assert.deepEqual(byPath.get('binary').workingStats,{additions:null,deletions:null});
  assert.deepEqual(byPath.get('new\tline\n.ts').workingStats,{additions:2,deletions:0});
  assert.deepEqual(byPath.get('new-binary').workingStats,{additions:null,deletions:null});
  assert.deepEqual(byPath.get('link').workingStats,{additions:1,deletions:0});
});
test('unborn staged files and renamed paths have correct counts without loading previews',async t=>{
  const root=await repository(t);
  await writeFile(join(root,'old\nname.ts'),Array.from({length:20},(_,i)=>`line ${i}\n`).join(''));
  await gitCommand(root,['add','--all']);
  assert.deepEqual((await repositoryStatus('test',root,undefined,true)).files[0].stagedStats,{additions:20,deletions:0});
  await gitCommand(root,['commit','-m','Baseline']);await gitCommand(root,['mv','--','old\nname.ts','new\tname.ts']);
  await writeFile(join(root,'new\tname.ts'),Array.from({length:20},(_,i)=>`line ${i===3 ? 'changed':i}\n`).join(''));await gitCommand(root,['add','--all']);
  const file=(await repositoryStatus('test',root,undefined,true)).files[0];
  assert.equal(file.originalPath,'old\nname.ts');assert.deepEqual(file.stagedStats,{additions:1,deletions:1});
});
test('bounded untracked admission represents oversized and excess files as unknown, not zero',async t=>{
  const root=await repository(t);
  await writeFile(join(root,'a-large'),Buffer.alloc(4*1024*1024+1,120));
  await Promise.all(Array.from({length:129},(_,i)=>writeFile(join(root,`file-${i}`),'one\n')));
  const status=await repositoryStatus('test',root,undefined,true);
  assert.equal(status.files.find(file=>file.path==='a-large').workingStats,null);
  assert.ok(status.files.filter(file=>file.workingStats===null).length>=2);
  assert.ok(status.files.some(file=>file.workingStats?.additions===1));
});
