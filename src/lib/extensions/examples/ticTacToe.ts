// Example: a tic-tac-toe minigame against the computer. Shows settings, per-character storage and posting results to the chat.

import type { ExtensionBundle } from '../manifest'

const PANEL = String.raw`<div class="rp-stack" style="max-width:340px;margin:0 auto">
  <div class="rp-row" style="justify-content:space-between">
    <div><b id="who">You vs the computer</b><div class="rp-muted" id="score" style="font-size:12px"></div></div>
    <button class="rp-btn" id="again">New game</button>
  </div>
  <div id="board" class="board"></div>
  <div class="rp-center" id="status" style="min-height:28px;font-weight:600"></div>
</div>
<style>
  .board{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
  .cell{aspect-ratio:1;border:0;border-radius:16px;background:rgb(var(--c-bg-sunken));color:rgb(var(--c-text));font-size:2.4rem;font-weight:700;cursor:pointer;transition:transform .08s,background .15s}
  .cell:hover:not(:disabled){transform:scale(1.03);background:rgb(var(--c-accent)/.12)}
  .cell:disabled{cursor:default}
  .cell.x{color:rgb(var(--c-accent))}
  .cell.win{background:rgb(var(--c-accent)/.22)}
</style>
<script>
(async function () {
  var info = await rp.ready;
  var LINES = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
  var $ = function (id) { return document.getElementById(id); };
  var cells, over, score = { w: 0, l: 0, d: 0 }, name = 'the computer';
  var canChat = info.permissions.indexOf('chat.write') >= 0;

  function winner(b) {
    for (var i = 0; i < LINES.length; i++) {
      var l = LINES[i];
      if (b[l[0]] && b[l[0]] === b[l[1]] && b[l[0]] === b[l[2]]) return { who: b[l[0]], line: l };
    }
    return b.every(Boolean) ? { who: 'draw', line: [] } : null;
  }
  function minimax(b, turn) {
    var w = winner(b);
    if (w) return w.who === 'O' ? 1 : w.who === 'X' ? -1 : 0;
    var best = turn === 'O' ? -2 : 2;
    for (var i = 0; i < 9; i++) {
      if (b[i]) continue;
      b[i] = turn;
      var s = minimax(b, turn === 'O' ? 'X' : 'O');
      b[i] = '';
      best = turn === 'O' ? Math.max(best, s) : Math.min(best, s);
    }
    return best;
  }
  function aiMove() {
    var empty = []; for (var i = 0; i < 9; i++) if (!cells[i]) empty.push(i);
    if (info.settings.difficulty === 'easy' && Math.random() < 0.7) return empty[Math.floor(Math.random() * empty.length)];
    var best = -3, pick = empty[0];
    empty.forEach(function (i) {
      cells[i] = 'O';
      var s = minimax(cells, 'X');
      cells[i] = '';
      if (s > best || (s === best && Math.random() < 0.3)) { best = s; pick = i; }
    });
    return pick;
  }
  function draw(line) {
    var board = $('board'); board.innerHTML = '';
    cells.forEach(function (v, i) {
      var b = document.createElement('button');
      b.className = 'cell ' + (v === 'X' ? 'x' : '') + (line && line.indexOf(i) >= 0 ? ' win' : '');
      b.textContent = v; b.disabled = over || !!v;
      b.onclick = function () { play(i); };
      board.appendChild(b);
    });
    $('score').textContent = 'Wins ' + score.w + ' · Losses ' + score.l + ' · Draws ' + score.d;
  }
  async function finish(w) {
    over = true;
    var text = w.who === 'X' ? 'You win!' : w.who === 'O' ? name + ' wins.' : 'A draw.';
    $('status').textContent = text;
    if (w.who === 'X') score.w++; else if (w.who === 'O') score.l++; else score.d++;
    draw(w.line);
    try { await rp.storage.set('score', score, 'character'); } catch (e) {}
    if (info.settings.announce && canChat) {
      var line = w.who === 'X' ? '*beats ' + name + ' at tic-tac-toe*' : w.who === 'O' ? '*loses a game of tic-tac-toe to ' + name + '*' : '*plays tic-tac-toe with ' + name + ' and it ends in a draw*';
      try { await rp.chat.append(line, { as: 'user' }); } catch (e) { rp.log(e.message); }
    }
  }
  function play(i) {
    if (over || cells[i]) return;
    cells[i] = 'X';
    var w = winner(cells);
    if (w) return finish(w);
    cells[aiMove()] = 'O';
    w = winner(cells);
    if (w) return finish(w);
    draw();
  }
  function reset() { cells = Array(9).fill(''); over = false; $('status').textContent = 'Your move'; draw(); }

  try { var c = await rp.chat.info(); if (c) { name = c.characterName || name; $('who').textContent = 'You vs ' + name; } } catch (e) {}
  try { score = (await rp.storage.get('score', 'character')) || score; } catch (e) {}
  $('again').onclick = reset;
  reset();
})();
</script>`

export const ticTacToe: ExtensionBundle = {
  format: 'rp-extension',
  version: 1,
  manifest: {
    id: 'tic-tac-toe',
    name: 'Tic-Tac-Toe',
    version: '1.0.0',
    description: 'A quick minigame against the computer. The score is kept per character, and results can be posted to the chat.',
    author: 'rp',
    glyph: '✕',
    api: 1,
    permissions: ['chat.read', 'chat.write'],
    panels: [{ id: 'game', title: 'Tic-Tac-Toe', glyph: '✕', entry: 'panel.html', slots: ['chat', 'view'] }],
    hooks: [],
    tools: [],
    settings: [
      { key: 'difficulty', type: 'select', label: 'Difficulty', options: ['easy', 'hard'], default: 'hard', hint: 'Hard never loses; the best you can do is draw.' },
      { key: 'announce', type: 'boolean', label: 'Post results to the chat', default: true },
    ],
  },
  files: { 'panel.html': PANEL },
}
