import { spotifyUri } from './label.js';
let lastRequest = 0;
let requestQueue = Promise.resolve();

// MusicBrainz asks clients to stay below one request per second.
export function musicBrainz(path, signal) {
  const request = requestQueue.catch(() => {}).then(async () => {
    const delay = Math.max(0, 1100 - (Date.now() - lastRequest));
    if (delay) await new Promise(resolve => setTimeout(resolve, delay));
    for (let attempt = 0; attempt < 3; attempt++) {
      signal?.throwIfAborted(); lastRequest = Date.now();
      const response = await fetch(`https://musicbrainz.org/ws/2/${path}`, {
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000),
        headers: { Accept: 'application/json' },
      });
      if (response.ok) return response.json();
      if (![429, 502, 503, 504].includes(response.status) || attempt === 2) {
        throw new Error(`MusicBrainz: ${response.status}. Please try again later.`);
      }
      // Read-only catalog requests may be retried; printer jobs never are.
      await new Promise(resolve => setTimeout(resolve, 1500 * (attempt + 1)));
    }
  });
  requestQueue = request;
  return request;
}

export async function searchAlbums(query, signal) {
  // User text is quoted to avoid Lucene operators changing the query.
  const term = query.replace(/["\\]/g, ' ').trim();
  if (!term) return [];
  const q = `(releasegroup:"${term}" OR artist:"${term}") AND primarytype:album`;
  const data = await musicBrainz(`release-group/?query=${encodeURIComponent(q)}&fmt=json&limit=18`, signal);
  return (data['release-groups'] || []).map(item => ({
    id: item.id, title: item.title,
    artist: (item['artist-credit'] || []).map(a => `${a.name || a.artist?.name || ''}${a.joinphrase || ''}`).join(''),
    year: (item['first-release-date'] || '').slice(0, 4),
    type: item['secondary-types']?.join(', ') || 'Album',
  }));
}

export async function findSpotify(id, signal) {
  const data = await musicBrainz(`release-group/${id}?inc=url-rels&fmt=json`, signal);
  const uri = (data.relations || []).map(r => spotifyUri(r.url?.resource || '')).find(Boolean);
  if (uri) return uri;
  // Streaming links are normally attached to releases, not release groups.
  // Bound the lookup: a large discography must not trigger hundreds of requests.
  for (const offset of [0, 25]) {
    const releases = await musicBrainz(`release/?release-group=${id}&inc=url-rels&fmt=json&limit=25&offset=${offset}`, signal);
    for (const release of releases.releases || []) {
      const found = (release.relations || []).map(r => spotifyUri(r.url?.resource || '')).find(Boolean);
      if (found) return found;
    }
    if ((releases['release-count'] || 0) <= offset + 25) break;
  }
  return null;
}

export async function loadSpotifyCode(uri, signal) {
  const url = `https://scannables.scdn.co/uri/plain/png/ffffff/black/640/${encodeURIComponent(uri)}`;
  const response = await fetch(url, { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error('Spotify did not return the code image. Please try again.');
  const blob = await response.blob();
  if (!blob.type.startsWith('image/')) throw new Error('Spotify returned an invalid image.');
  const objectUrl = URL.createObjectURL(blob);
  try {
    const img = new Image(); img.src = objectUrl; await img.decode(); return img;
  } finally { URL.revokeObjectURL(objectUrl); }
}
