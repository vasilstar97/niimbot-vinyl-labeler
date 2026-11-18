import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { App as AntApp, Button, Checkbox, Collapse, ConfigProvider, Drawer, Input, InputNumber, Select, Spin } from 'antd';
import enUS from 'antd/locale/en_US';
import 'antd/dist/reset.css';
import '@fontsource/open-sans/latin-400.css';
import '@fontsource/open-sans/latin-700.css';
import '@fontsource/open-sans/cyrillic-400.css';
import '@fontsource/open-sans/cyrillic-700.css';
import './style.css';
import { defaults, drawLabel, mmToPx, printCrop, spotifyUri } from './label.js';
import { findSpotify, loadSpotifyCode, searchAlbums } from './catalog.js';
import { Printer } from './printer.js';

const storageKey = 'side-a-draft-v1';
const presets = ['50x30', '40x30', '50x50'];
function readDraft() {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || 'null');
    const settings = { ...defaults };
    for (const key of Object.keys(defaults)) if (Number.isFinite(saved?.settings?.[key]) && saved.settings[key] > 0) settings[key] = saved.settings[key];
    return { settings, ...Object.fromEntries(['artist', 'album', 'spotify'].map(key => [key, typeof saved?.[key] === 'string' ? saved[key] : ''])), unavailable: saved?.unavailable === true };
  } catch { return { settings: { ...defaults }, artist: '', album: '', spotify: '', unavailable: false }; }
}
function download(blob, name) {
  const url = URL.createObjectURL(blob), link = document.createElement('a');
  link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function Field({ label, id, children, extra }) {
  return <div className="field"><div className="field-label"><label htmlFor={id}>{label}</label>{extra}</div>{children}</div>;
}

function LabelStudio() {
  const { message } = AntApp.useApp();
  const [draft, setDraft] = useState(readDraft);
  const { settings, artist, album, spotify, unavailable } = draft;
  const [query, setQuery] = useState(''), [results, setResults] = useState([]), [selected, setSelected] = useState(null);
  const [searching, setSearching] = useState(false), [searchStatus, setSearchStatus] = useState('');
  const [lookingUp, setLookingUp] = useState(false), [lookupStatus, setLookupStatus] = useState('');
  const [codeState, setCodeState] = useState({ uri: null, image: null, loading: false, error: '' });
  const [codeRetry, setCodeRetry] = useState(0), [fontsReady, setFontsReady] = useState(false), [renderErrors, setRenderErrors] = useState([]);
  const [printerStatus, setPrinterStatus] = useState('Not connected'), [meta, setMeta] = useState(null), [roll, setRoll] = useState(null);
  const [connecting, setConnecting] = useState(false), [printing, setPrinting] = useState(false);
  const [direction, setDirection] = useState('top'), [density, setDensity] = useState(3), [zoom, setZoom] = useState('fit');
  const [stageSize, setStageSize] = useState({ width: 600, height: 600 });
  const [compact, setCompact] = useState(() => matchMedia('(max-width: 850px)').matches), [drawer, setDrawer] = useState(null);
  const canvasRef = useRef(null), stageRef = useRef(null), printerRef = useRef(null);
  const searchRef = useRef(null), lookupRef = useRef(null), printLock = useRef(false);

  if (!printerRef.current) printerRef.current = new Printer((status, detected) => {
    setPrinterStatus(status);
    if (detected) {
      setMeta(detected);
      setDraft(previous => ({ ...previous, settings: { ...previous.settings, dpi: detected.dpi } }));
      setDirection(detected.printDirection); setDensity(detected.densityDefault);
      setRoll(printerRef.current.client?.getRfidInfo().labelRfidInfo || null);
    }
  });
  const printer = printerRef.current, uri = spotifyUri(spotify);
  const code = !unavailable && codeState.uri === uri ? codeState.image : null;

  useEffect(() => {
    try { localStorage.setItem(storageKey, JSON.stringify(draft)); } catch { /* Storage is optional. */ }
  }, [draft]);
  useEffect(() => {
    let active = true;
    Promise.all([document.fonts.load('400 16px "Open Sans"'), document.fonts.load('700 16px "Open Sans"')])
      .then(() => { if (active) setFontsReady(true); }).catch(() => message.error('Could not load Open Sans. Reload the page.'));
    const media = matchMedia('(max-width: 850px)'), resize = () => setCompact(media.matches);
    media.addEventListener('change', resize);
    return () => { active = false; media.removeEventListener('change', resize); searchRef.current?.abort(); lookupRef.current?.abort(); };
  }, []);
  useLayoutEffect(() => {
    const observer = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect; setStageSize({ width, height });
    });
    observer.observe(stageRef.current); return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    if (!uri || unavailable) { setCodeState({ uri: null, image: null, loading: false, error: '' }); return () => controller.abort(); }
    setCodeState({ uri, image: null, loading: true, error: '' });
    loadSpotifyCode(uri, controller.signal).then(image => {
      if (!controller.signal.aborted) setCodeState({ uri, image, loading: false, error: '' });
    }).catch(error => {
      if (!controller.signal.aborted) setCodeState({ uri, image: null, loading: false, error: error.message });
    });
    return () => controller.abort();
  }, [uri, unavailable, codeRetry]);
  useLayoutEffect(() => {
    try { setRenderErrors(drawLabel(canvasRef.current, settings, artist, album, code, unavailable).errors); }
    catch (error) {
      setRenderErrors([error.message]);
      const canvas = canvasRef.current; canvas.width = 400; canvas.height = 240;
      const ctx = canvas.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 400, 240);
    }
  }, [settings, artist, album, code, unavailable, fontsReady]);

  function invalidateLookup() { lookupRef.current?.abort(); setLookingUp(false); setLookupStatus(''); }
  function edit(key, value) {
    invalidateLookup(); setDraft(previous => ({ ...previous, [key]: value, ...(key === 'spotify' ? { unavailable: false } : {}) }));
  }
  function setting(key, value) { setDraft(previous => ({ ...previous, settings: { ...previous.settings, [key]: value ?? 0 } })); }
  async function search() {
    if (query.trim().length < 2) return;
    searchRef.current?.abort(); const controller = new AbortController(); searchRef.current = controller;
    setSearching(true); setSearchStatus(''); setResults([]);
    try {
      const found = await searchAlbums(query, controller.signal);
      if (!controller.signal.aborted) { setResults(found); setSearchStatus(found.length ? '' : 'No albums found. Try the artist or album title separately.'); }
    } catch (error) { if (!controller.signal.aborted) setSearchStatus(`${error.message} You can enter the details manually.`); }
    finally { if (!controller.signal.aborted) setSearching(false); }
  }
  async function selectAlbum(item) {
    lookupRef.current?.abort(); const controller = new AbortController(); lookupRef.current = controller;
    setSelected(item.id); setLookingUp(true); setLookupStatus('');
    setDraft(previous => ({ ...previous, artist: item.artist, album: item.title, spotify: '', unavailable: false }));
    try {
      const found = await findSpotify(item.id, controller.signal);
      if (controller.signal.aborted) return;
      if (found) setDraft(previous => ({ ...previous, spotify: `https://open.spotify.com/album/${found.split(':')[2]}` }));
      else setLookupStatus('No Spotify link in MusicBrainz. Paste an album link below.');
    } catch { if (!controller.signal.aborted) setLookupStatus('Could not look up Spotify. You can paste a link manually.'); }
    finally { if (!controller.signal.aborted) setLookingUp(false); }
  }

  const errors = [...renderErrors];
  if (!artist.trim() || !album.trim()) errors.push('Enter an artist and album title.');
  if (!fontsReady) errors.push('Loading Open Sans…');
  if (!code && !unavailable) errors.push(lookingUp ? 'Looking up Spotify…' : codeState.loading ? 'Loading Spotify Code…' : 'Add a Spotify album link or select “Not on Spotify”.');
  if (printer.connected && meta) {
    if (settings.dpi !== meta.dpi) errors.push(`Use ${meta.dpi} dpi for this printer.`);
    try { printCrop(mmToPx(settings.width, settings.dpi), mmToPx(settings.height, settings.dpi), meta.printheadPixels, direction, mmToPx(settings.margin, settings.dpi)); }
    catch (error) { errors.push(error.message); }
  }
  const valid = errors.length === 0, blocked = printing || connecting, format = `${settings.width}x${settings.height}`;
  const ratio = settings.width / settings.height;
  const fitWidth = Math.max(1, Math.min(stageSize.width - 80, (stageSize.height - 80) * ratio));
  const previewWidth = zoom === 'fit' ? Math.min(fitWidth, mmToPx(settings.width, 96) * 3) : mmToPx(settings.width, 96) * zoom;
  const spotifySearch = `https://open.spotify.com/search/${encodeURIComponent(`${artist} ${album}`.trim())}`;
  async function connect(transport) {
    if (blocked) return;
    setConnecting(true); setPrinterStatus('Choose your printer in the browser dialog…');
    try { await printer.connect(transport); } catch (error) { setPrinterStatus(`Not connected: ${error.message}`); }
    finally { setConnecting(false); }
  }
  async function disconnect() {
    try { await printer.disconnect(); setPrinterStatus('Not connected'); } catch (error) { message.error(error.message); }
  }
  function exportPng() {
    if (!valid || printing) return;
    canvasRef.current.toBlob(blob => {
      if (blob) download(blob, `vinyl-${settings.width}x${settings.height}-${settings.dpi}dpi.png`);
      else message.error('Could not export the image.');
    }, 'image/png');
  }
  function exportLog() {
    const diagnostics = printer.getDiagnostics();
    if (!diagnostics.entries.length) return message.info('No printer events in this session yet.');
    download(new Blob([JSON.stringify(diagnostics, null, 2)], { type: 'application/json' }), 'vinyl-print-diagnostics.json');
  }
  async function print() {
    if (printLock.current || !valid || !printer.connected || connecting) return;
    printLock.current = true; setPrinting(true);
    const snapshot = document.createElement('canvas'); snapshot.width = canvasRef.current.width; snapshot.height = canvasRef.current.height;
    snapshot.getContext('2d').drawImage(canvasRef.current, 0, 0);
    try { await printer.print(snapshot, { ...settings }, direction, density); message.success('The printer reported that the job is complete.'); }
    catch (error) { message.error({ content: `Print interrupted: ${error.message} The job was not retried. Check the label before printing again.`, duration: 12 }); }
    finally { printLock.current = false; setPrinting(false); }
  }

  const albumPanel = <>
    <div className="panel-heading"><h1>Album</h1><span className="muted">Vinyl Labeler</span></div>
    <div className="panel-body album-body">
      <Field label="Search" id="query"><Input.Search id="query" placeholder="Artist or album" value={query} onChange={e => setQuery(e.target.value)} onSearch={search} loading={searching} enterButton aria-label="Search albums" /></Field>
      {searchStatus && <p className="field-status" role="status">{searchStatus}</p>}
      {!!results.length && <div className="album-results" aria-label="Search results">{results.map(item => <Button key={item.id} type="text" block className={`album-result${selected === item.id ? ' selected' : ''}`} onClick={() => selectAlbum(item)}><span className="result-text"><strong>{item.title}</strong><span>{item.artist}</span></span><span className="result-year">{item.year}</span></Button>)}</div>}
      <div className="section-separator" />
      <Field label="Artist" id="artist"><Input.TextArea id="artist" value={artist} onChange={e => edit('artist', e.target.value)} autoSize={{ minRows: 2, maxRows: 3 }} placeholder="Artist name" /></Field>
      <Field label="Album title" id="album"><Input.TextArea id="album" value={album} onChange={e => edit('album', e.target.value)} autoSize={{ minRows: 2, maxRows: 3 }} placeholder="Album title" /></Field>
      <Field label="Spotify album" id="spotify" extra={<a href={spotifySearch} target="_blank" rel="noreferrer">Find ↗</a>}><Input id="spotify" value={spotify} onChange={e => edit('spotify', e.target.value)} placeholder="https://open.spotify.com/album/…" disabled={unavailable} /></Field>
      <Checkbox id="unavailable" checked={unavailable} onChange={e => { invalidateLookup(); setDraft(previous => ({ ...previous, unavailable: e.target.checked })); }}>Not on Spotify</Checkbox>
      <div className="code-status field-status" role="status">{unavailable ? 'The label will read “not available on spotify”.' : lookingUp ? <><Spin size="small" /> Looking up Spotify…</> : codeState.loading ? <><Spin size="small" /> Loading Spotify Code…</> : code ? 'Spotify Code ready.' : codeState.error || lookupStatus || (spotify.trim() && !uri ? 'Use a full Spotify album URL or spotify:album:… URI.' : 'Paste a link to add a Spotify Code.')}{codeState.error && !unavailable && <Button type="link" size="small" onClick={() => setCodeRetry(n => n + 1)}>Retry</Button>}</div>
    </div><div className="panel-note">Saved on this device</div>
  </>;
  const printPanel = <>
    <div className="panel-heading"><h2>Print settings</h2></div>
    <div className="panel-body print-body">
      <Field label="Label size" id="preset"><Select id="preset" value={presets.includes(format) ? format : 'custom'} options={[...presets.map(value => ({ value, label: `${value.replace('x', ' × ')} mm` })), { value: 'custom', label: 'Custom' }]} onChange={value => {
        if (value !== 'custom') { const [width, height] = value.split('x').map(Number); setDraft(previous => ({ ...previous, settings: { ...previous.settings, width, height } })); }
      }} /></Field>
      <div className="field-pair">{[['width', 'Width (mm)', 150], ['height', 'Height (mm)', 200]].map(([key, label, max]) => <Field key={key} label={label} id={key}><InputNumber id={key} min={15} max={max} step={.1} value={settings[key]} onChange={value => setting(key, value)} /></Field>)}</div>
      <Field label="Resolution" id="dpi"><Select id="dpi" value={settings.dpi} options={[...new Set([203, 300, ...(meta ? [meta.dpi] : [])])].map(value => ({ value, label: `${value} dpi` }))} onChange={value => setting('dpi', value)} /></Field>
      <Collapse ghost size="small" items={[{ key: 'layout', label: 'Layout', children: <><div className="field-pair">{[['margin', 'Outer margin (mm)'], ['padding', 'Cell padding (mm)'], ['font', 'Font size (mm)'], ['lineHeight', 'Line step (mm)']].map(([key, label]) => <Field key={key} label={label} id={key}><InputNumber id={key} min={.1} max={20} step={.1} value={settings[key]} onChange={value => setting(key, value)} /></Field>)}</div><p className="field-status">Open Sans · line step is baseline spacing.</p></> }]} />
      <div className="section-separator" />
      <div className="printer-status" role="status"><span className={`status-dot${printer.connected ? ' connected' : ''}`} />{printerStatus}</div>
      <div className="connection-actions">{printer.connected ? <Button block onClick={disconnect} disabled={blocked}>Disconnect</Button> : <><Button onClick={() => connect('serial')} loading={connecting} disabled={blocked}>USB</Button><Button onClick={() => connect('bluetooth')} disabled={blocked}>Bluetooth</Button></>}</div>
      {printer.connected && roll?.tagPresent && <div className="roll-info"><span>Roll {roll.barCode || 'detected'}</span>{roll.allPaper >= 0 && roll.usedPaper >= 0 && roll.usedPaper <= roll.allPaper && <span>{roll.allPaper - roll.usedPaper} / {roll.allPaper} labels remaining</span>}</div>}
      <Field label="Orientation" id="direction"><Select id="direction" value={direction} options={[{ value: 'top', label: '0°' }, { value: 'left', label: '90° clockwise' }]} onChange={setDirection} disabled={printing} /></Field>
      <Field label="Density" id="density"><Select id="density" value={density} options={Array.from({ length: meta ? meta.densityMax - meta.densityMin + 1 : 5 }, (_, i) => ({ value: (meta?.densityMin || 1) + i, label: String((meta?.densityMin || 1) + i) }))} onChange={setDensity} disabled={printing} /></Field>
    </div>
    <div className="panel-actions"><Button type="primary" block id="print" onClick={print} loading={printing} disabled={!valid || !printer.connected || connecting}>Print 1 label</Button><Button block id="export" onClick={exportPng} disabled={!valid || printing}>Download PNG</Button><Button type="text" size="small" onClick={exportLog}>Download print log</Button></div>
  </>;
  return <main className="studio">
    {!compact && <aside className="sidebar album-sidebar" aria-label="Album editor">{albumPanel}</aside>}
    <section className="preview" aria-label="Label preview">
      <div className="preview-toolbar">{compact && <Button onClick={() => setDrawer('album')}>Album</Button>}<span className="preview-dimensions">{settings.width} × {settings.height} mm <span>· {settings.dpi} dpi</span></span><div className="preview-controls"><Button type={zoom === 'fit' ? 'default' : 'text'} onClick={() => setZoom('fit')}>Fit</Button><Select aria-label="Preview zoom" value={zoom} onChange={setZoom} options={[{ value: 'fit', label: 'Auto' }, ...[1, 2, 3].map(value => ({ value, label: `${value * 100}%` }))]} /></div>{compact && <Button onClick={() => setDrawer('print')}>Print</Button>}</div>
      <div className="preview-stage" ref={stageRef}><div className="canvas-holder"><canvas id="label" ref={canvasRef} aria-label="Label artwork" style={{ width: `${previewWidth}px`, aspectRatio: Number.isFinite(ratio) && ratio > 0 ? String(ratio) : '5 / 3' }} /></div></div>
      <div className={`preview-status${valid ? '' : ' has-errors'}`} role="status"><span>{valid ? 'Ready' : [...new Set(errors)].join(' ')}</span><span className="raster-size">{mmToPx(settings.width, settings.dpi)} × {mmToPx(settings.height, settings.dpi)} px</span></div>
    </section>
    {!compact && <aside className="sidebar print-sidebar" aria-label="Print settings">{printPanel}</aside>}
    {compact && <Drawer title={drawer === 'album' ? 'Album' : 'Print settings'} placement={drawer === 'album' ? 'left' : 'right'} open={!!drawer} onClose={() => setDrawer(null)} size={300} classNames={{ body: 'mobile-panel' }}>{drawer === 'album' ? albumPanel : printPanel}</Drawer>}
  </main>;
}

createRoot(document.getElementById('app')).render(<ConfigProvider locale={enUS} theme={{ token: {
  colorPrimary: '#f55e36', colorText: '#000000', colorTextSecondary: '#737373', colorBgContainer: '#ffffff', colorBgLayout: '#f5f5f5',
  colorBorder: '#d9d9d9', colorError: '#f55e36', colorWarning: '#f55e36', colorSuccess: '#000000', colorInfo: '#000000',
  borderRadius: 2, fontSize: 12, controlHeight: 30, fontFamily: '"Open Sans", sans-serif', lineWidth: 1,
} }}><AntApp><LabelStudio /></AntApp></ConfigProvider>);
