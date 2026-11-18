import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaults, geometry, mmToPx, printCrop, spotifyUri, wrapText } from '../src/label.js';

test('50 × 30 mm keeps all cells within safe margins', () => {
  const g = geometry(defaults);
  assert.equal(g.w, 44); assert.equal(g.h, 24);
  assert.equal(g.row, 6); assert.equal(g.codeHeight, 12);
  assert.equal(mmToPx(50, 203), 400); assert.equal(mmToPx(30, 203), 240);
});
test('B21S crops blank margins without scaling a 50mm label', () => {
  assert.deepEqual(printCrop(400,240,384,'top',24), { x:8, y:0, width:384, height:240 });
  assert.deepEqual(printCrop(400,240,384,'left',24), { x:0, y:0, width:400, height:240 });
  assert.throws(() => printCrop(560,240,384,'top',24), /printhead/);
  assert.throws(() => printCrop(432,240,384,'top',24), /printhead/);
});
test('rejects unusable geometry and extreme raster sizes', () => {
  assert.throws(() => geometry({ ...defaults, width: 10 }));
  assert.throws(() => geometry({ ...defaults, height: 12 }));
  assert.throws(() => geometry({ ...defaults, dpi: NaN }));
  assert.throws(() => geometry({ ...defaults, width: 10000 }));
});
test('Spotify code only accepts full album IDs from Spotify', () => {
  const id = '6dVIqQ8qmQ5GBnJ9shOYGE';
  assert.equal(spotifyUri(`https://open.spotify.com/album/${id}?si=123`), `spotify:album:${id}`);
  assert.equal(spotifyUri(`https://open.spotify.com/intl-ru/album/${id}`), `spotify:album:${id}`);
  assert.equal(spotifyUri(`spotify:album:${id}`), `spotify:album:${id}`);
  for (const v of ['https://evil.com/album/'+id, 'https://open.spotify.com/track/'+id, 'spotify:album:short', '', '<svg>']) assert.equal(spotifyUri(v), null);
});
test('wraps long names, single words and explicit line breaks without losing characters', () => {
  const measure = t => [...t].length;
  assert.deepEqual(wrapText('King Gizzard and the Lizard Wizard', 12, measure), ['King Gizzard','and the','Lizard','Wizard']);
  assert.deepEqual(wrapText('abcdefghijk',4,measure), ['abcd','efgh','ijk']);
  assert.deepEqual(wrapText('Artist\nname',10,measure), ['Artist','name']);
});
