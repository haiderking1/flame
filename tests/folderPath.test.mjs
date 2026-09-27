import assert from 'node:assert/strict';
import test from 'node:test';
import { directoryQuery, folderQuery } from '../src/renderer/components/projects/folderPath.ts';

test('folder navigation abbreviates only the home directory and its descendants', () => {
  const home = '/home/soka';
  assert.equal(directoryQuery(home, home), '~/');
  assert.equal(directoryQuery(`${home}/`, home), '~/');
  assert.equal(directoryQuery(`${home}/code`, home), '~/code/');
  assert.equal(directoryQuery(`${home}/code/`, `${home}/`), '~/code/');
  assert.equal(directoryQuery('/home/soka-other/code', home), '/home/soka-other/code/');
  assert.equal(directoryQuery('/home', home), '/home/');
  assert.equal(directoryQuery('/', home), '/');
  assert.equal(directoryQuery('/tmp/project', home), '/tmp/project/');
  assert.equal(directoryQuery('/tmp/project'), '/tmp/project/');
  assert.equal(directoryQuery('C:\\Users\\soka\\code', 'C:\\Users\\soka'), '~/code/');
  assert.equal(directoryQuery('D:\\code', 'C:\\Users\\soka'), 'D:\\code\\');
  assert.deepEqual(folderQuery('~/code/'), { directory: '~/code/', filter: '' });
});
