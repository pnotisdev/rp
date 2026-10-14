// Starter templates for new extensions, used by the in-app Studio and by agents creating extensions over MCP.

import type { ExtensionBundle } from './manifest.ts'

export type StarterKind = 'panel' | 'minigame' | 'script' | 'theme'

export const STARTER_KINDS: { id: StarterKind; label: string; blurb: string }[] = [
  { id: 'panel', label: 'Panel', blurb: 'A small app that lives in the chat dock or on its own screen.' },
  { id: 'minigame', label: 'Minigame', blurb: 'A canvas game with a saved high score.' },
  { id: 'script', label: 'Script', blurb: 'Background logic: rewrite replies, add to the prompt, react to events.' },
  { id: 'theme', label: 'Theme', blurb: 'Restyle the whole app with CSS.' },
]

export interface StarterOptions {
  id: string
  name: string
  description?: string
  kind: StarterKind
}

function esc(text: string): string {
  return text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c)
}

const PANEL_HTML = (name: string) =>
  `<div class="rp-stack">
  <h2>${esc(name)}</h2>
  <p class="rp-muted" id="hello">Loading…</p>
  <div class="rp-row">
    <button class="rp-btn primary" id="count">Clicked 0 times</button>
    <button class="rp-btn" id="toast">Say hi</button>
  </div>
</div>
<script>
(async function () {
  var info = await rp.ready;
  document.getElementById('hello').textContent = 'Running as "' + info.extension.name + '" with permissions: ' + (info.permissions.join(', ') || 'none');
  var clicks = (await rp.storage.get('clicks')) || 0;
  var button = document.getElementById('count');
  function paint() { button.textContent = 'Clicked ' + clicks + ' time' + (clicks === 1 ? '' : 's'); }
  paint();
  button.onclick = async function () { clicks++; paint(); await rp.storage.set('clicks', clicks); };
  document.getElementById('toast').onclick = function () { rp.notify('Hello from ' + info.extension.name, 'success'); };
})();
</script>`

const GAME_HTML = (name: string) =>
  `<div class="rp-stack" style="max-width:360px;margin:0 auto">
  <div class="rp-row" style="justify-content:space-between"><b>${esc(name)}</b><span class="rp-muted" id="score">Score 0 · Best 0</span></div>
  <canvas id="c" width="360" height="360" style="width:100%;border-radius:16px;background:rgb(var(--c-bg-sunken));touch-action:none"></canvas>
  <button class="rp-btn primary" id="start">Start</button>
</div>
<script>
(async function () {
  await rp.ready;
  var cv = document.getElementById('c'), g = cv.getContext('2d');
  var stars = [], score = 0, best = (await rp.storage.get('best')) || 0, playing = false, last = 0, spawn = 0, timeLeft = 30;
  var accent = getComputedStyle(document.documentElement).getPropertyValue('--c-accent').trim().split(' ').join(',');
  function label() { document.getElementById('score').textContent = 'Score ' + score + ' · Best ' + best + (playing ? ' · ' + Math.ceil(timeLeft) + 's' : ''); }
  function frame(t) {
    var dt = Math.min(0.05, (t - last) / 1000); last = t;
    g.clearRect(0, 0, 360, 360);
    if (playing) {
      timeLeft -= dt; spawn -= dt;
      if (spawn <= 0) { stars.push({ x: 20 + Math.random() * 320, y: -10, r: 12 + Math.random() * 10, v: 60 + Math.random() * 90 }); spawn = 0.45; }
      stars.forEach(function (s) { s.y += s.v * dt; });
      stars = stars.filter(function (s) { return s.y < 380; });
      if (timeLeft <= 0) finish();
    }
    g.fillStyle = 'rgb(' + accent + ')';
    stars.forEach(function (s) { g.beginPath(); g.arc(s.x, s.y, s.r, 0, 7); g.fill(); });
    label();
    requestAnimationFrame(frame);
  }
  async function finish() {
    playing = false;
    if (score > best) { best = score; try { await rp.storage.set('best', best); } catch (e) {} rp.notify('New best: ' + best, 'success'); }
    document.getElementById('start').textContent = 'Play again';
  }
  cv.addEventListener('pointerdown', function (e) {
    if (!playing) return;
    var b = cv.getBoundingClientRect(), x = (e.clientX - b.left) * 360 / b.width, y = (e.clientY - b.top) * 360 / b.height;
    for (var i = stars.length - 1; i >= 0; i--) {
      var s = stars[i];
      if ((s.x - x) * (s.x - x) + (s.y - y) * (s.y - y) < s.r * s.r * 1.6) { stars.splice(i, 1); score++; break; }
    }
  });
  document.getElementById('start').onclick = function () { stars = []; score = 0; timeLeft = 30; playing = true; };
  requestAnimationFrame(frame);
})();
</script>`

const SCRIPT_JS = `// Runs in a background worker (no DOM). Declare hooks in manifest.json, then register them here.
// input:   ({ text }) => string | { text } | { cancel: true, reason }   (before your message is sent)
// context: ({ lastUserText }) => string | { text, label }               (extra lines added to the prompt)
// output:  ({ text }) => string | { text }                               (the reply, before it is stored)

rp.hook('output', function (p) {
  return p.text.replace(/\\s+([,.!?])/g, '$1');
});

rp.on('message', function (m) {
  rp.log('new ' + m.role + ' message: ' + m.text.slice(0, 60));
});
`

const THEME_CSS = `/* Stable hooks: [data-rp-part] = sidebar, chat-header, message, composer, modal. */
[data-rp-part='message'] {
  border-radius: 20px;
}
[data-rp-part='sidebar'] {
  background: rgb(var(--c-bg-elevated) / 0.7) !important;
}
`

export function starterBundle(opts: StarterOptions): ExtensionBundle {
  const description = opts.description?.trim() || ''
  const base = { id: opts.id, name: opts.name, version: '0.1.0', description, author: '', api: 1 as const, hooks: [] as never[], tools: [] as never[], settings: [] as never[] }
  if (opts.kind === 'script') {
    return {
      format: 'rp-extension',
      version: 1,
      manifest: { ...base, glyph: '⌁', permissions: ['hooks', 'chat.read'], panels: [], script: 'main.js', hooks: ['output'] },
      files: { 'main.js': SCRIPT_JS },
    }
  }
  if (opts.kind === 'theme') {
    return {
      format: 'rp-extension',
      version: 1,
      manifest: { ...base, glyph: '◈', permissions: ['ui.theme'], panels: [], theme: { css: 'theme.css' } },
      files: { 'theme.css': THEME_CSS },
    }
  }
  const game = opts.kind === 'minigame'
  return {
    format: 'rp-extension',
    version: 1,
    manifest: {
      ...base,
      glyph: game ? '★' : '◇',
      permissions: [],
      panels: [{ id: 'main', title: opts.name.slice(0, 40), glyph: game ? '★' : '◇', entry: 'panel.html', slots: ['view', 'chat'] }],
    },
    files: { 'panel.html': game ? GAME_HTML(opts.name) : PANEL_HTML(opts.name) },
  }
}
