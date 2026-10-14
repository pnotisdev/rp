// The `rp` SDK as plain JS source, injected into sandboxed panels and script workers. No backticks or ${ inside.

/** Shared by panels and workers: builds the `rp` object over a post/dispatch pair. */
export const SDK_CORE = String.raw`
function createRp(env) {
  var nextId = 1;
  var pending = Object.create(null);
  var listeners = Object.create(null);
  var subscribed = Object.create(null);
  var hooks = Object.create(null);
  var tools = Object.create(null);
  var queue = [];
  var connected = false;
  var info = null;
  var resolveReady;
  var ready = new Promise(function (r) { resolveReady = r; });

  function post(msg) { if (connected) env.post(msg); else queue.push(msg); }
  function format(args) {
    var out = [];
    for (var i = 0; i < args.length; i++) {
      var a = args[i];
      if (typeof a === 'string') out.push(a);
      else if (a && a.stack) out.push(String(a.stack));
      else { try { out.push(JSON.stringify(a)); } catch (e) { out.push(String(a)); } }
    }
    var s = out.join(' ');
    return s.length > 2000 ? s.slice(0, 2000) + '...' : s;
  }
  function log(level, args) { post({ t: 'log', level: level, text: format(args) }); }
  function call(method, params) {
    return new Promise(function (resolve, reject) {
      var id = nextId++;
      pending[id] = { resolve: resolve, reject: reject };
      post({ t: 'call', id: id, method: method, params: params === undefined ? {} : params });
    });
  }
  function emit(event, payload) {
    var list = listeners[event];
    if (!list) return;
    list.slice().forEach(function (fn) {
      try { fn(payload); } catch (e) { log('error', [e]); }
    });
  }
  function respond(kind, id, work) {
    Promise.resolve().then(work).then(
      function (result) { post({ t: kind, id: id, result: result === undefined ? null : result }); },
      function (err) { post({ t: kind, id: id, error: String((err && err.message) || err) }); }
    );
  }
  function dispatch(msg) {
    if (!msg || typeof msg !== 'object') return;
    if (msg.t === 'init') {
      info = msg.info || null;
      connected = true;
      var q = queue;
      queue = [];
      q.forEach(function (m) { env.post(m); });
      resolveReady(info);
    } else if (msg.t === 'result') {
      var p = pending[msg.id];
      if (!p) return;
      delete pending[msg.id];
      if (msg.error) p.reject(new Error(msg.error)); else p.resolve(msg.result);
    } else if (msg.t === 'event') {
      emit(msg.event, msg.payload);
    } else if (msg.t === 'theme') {
      emit('theme', { tokens: msg.tokens, dark: msg.dark });
    } else if (msg.t === 'hook') {
      var h = hooks[msg.name];
      if (!h) { post({ t: 'hookResult', id: msg.id, result: null, skipped: true }); return; }
      respond('hookResult', msg.id, function () { return h(msg.payload); });
    } else if (msg.t === 'tool') {
      var fn = tools[msg.name];
      if (!fn) { post({ t: 'toolResult', id: msg.id, error: 'Unknown tool ' + msg.name }); return; }
      respond('toolResult', msg.id, function () { return fn(msg.args); });
    }
  }
  function scoped(method, fields) {
    return function () {
      var params = {};
      for (var i = 0; i < fields.length; i++) params[fields[i]] = arguments[i];
      return call(method, params);
    };
  }

  var rp = {
    version: 1,
    ready: ready,
    get info() { return info; },
    on: function (event, fn) {
      (listeners[event] = listeners[event] || []).push(fn);
      if (!subscribed[event] && event !== 'theme') {
        subscribed[event] = true;
        call('subscribe', { event: event }).catch(function (e) { log('error', [e]); });
      }
      return function () {
        var l = listeners[event];
        var i = l ? l.indexOf(fn) : -1;
        if (i >= 0) l.splice(i, 1);
      };
    },
    log: function () { log('log', arguments); },
    notify: function (text, kind) { return call('notify', { text: String(text), kind: kind || 'info' }); },
    resize: function (height) { return call('resize', { height: height }); },
    close: function () { return call('close'); },
    generate: function (prompt, options) { return call('generate', { prompt: prompt, options: options || {} }); },
    settings: { all: function () { return call('settings.all'); } },
    storage: {
      get: function (key, scope) { return call('storage.get', { key: key, scope: scope || 'global' }); },
      set: function (key, value, scope) { return call('storage.set', { key: key, value: value, scope: scope || 'global' }); },
      remove: function (key, scope) { return call('storage.remove', { key: key, scope: scope || 'global' }); },
      keys: function (scope) { return call('storage.keys', { scope: scope || 'global' }); }
    },
    chat: {
      info: scoped('chat.info', []),
      messages: scoped('chat.messages', ['limit']),
      append: function (text, options) { return call('chat.append', { text: text, as: (options && options.as) || 'char' }); },
      send: scoped('chat.send', ['text'])
    },
    state: {
      get: scoped('state.get', []),
      setFlag: function (flag, on) { return call('state.setFlag', { flag: flag, on: on === undefined ? true : !!on }); },
      addCoins: scoped('state.addCoins', ['amount']),
      giveItem: function (id, count) { return call('state.giveItem', { id: id, count: count === undefined ? 1 : count }); }
    },
    lore: {
      books: scoped('lore.books', []),
      entries: scoped('lore.entries', ['bookId']),
      add: scoped('lore.add', ['bookId', 'entry']),
      remove: scoped('lore.remove', ['bookId', 'entryId'])
    },
    facts: {
      list: scoped('facts.list', []),
      add: function (text, importance) { return call('facts.add', { text: text, importance: importance === undefined ? 0.5 : importance }); }
    },
    characters: { list: scoped('characters.list', []) },
    hook: function (name, fn) { hooks[name] = fn; },
    tool: function (name, fn) { tools[name] = fn; }
  };
  return { rp: rp, dispatch: dispatch, log: log, post: post };
}
`

const CONSOLE_CAPTURE = String.raw`
['log', 'info', 'warn', 'error'].forEach(function (level) {
  var orig = console[level];
  console[level] = function () {
    try { core.log(level === 'info' ? 'log' : level, arguments); } catch (e) {}
    if (orig) orig.apply(console, arguments);
  };
});
`

/** Runs inside a visible panel iframe, after SDK_CORE. */
export const PANEL_BOOT = String.raw`
(function () {
  var port = null;
  var core = createRp({ post: function (m) { port.postMessage(m); } });
  /*__CONSOLE__*/
  function applyTheme(p) {
    if (!p) return;
    var root = document.documentElement;
    if (p.tokens) for (var k in p.tokens) root.style.setProperty(k, p.tokens[k]);
    root.classList.toggle('dark', !!p.dark);
    // Without this the frame keeps the scheme it loaded with, and the browser paints an opaque background when the app switches mode.
    root.style.colorScheme = p.dark ? 'dark' : 'light';
  }
  window.addEventListener('error', function (e) {
    core.log('error', [(e.message || 'Error') + (e.filename ? ' (' + e.filename + ':' + e.lineno + ')' : '')]);
  });
  window.addEventListener('unhandledrejection', function (e) {
    core.log('error', ['Unhandled rejection: ' + String((e.reason && e.reason.message) || e.reason)]);
  });
  window.addEventListener('message', function (e) {
    if (port || e.source !== window.parent || !e.data || e.data.t !== 'init' || !e.ports || !e.ports[0]) return;
    port = e.ports[0];
    port.onmessage = function (ev) {
      var m = ev.data;
      if (m && m.t === 'theme') applyTheme(m);
      core.dispatch(m);
    };
    applyTheme(e.data);
    core.dispatch(e.data);
    if (document.documentElement.getAttribute('data-rp-autoheight') && window.ResizeObserver) {
      var last = 0;
      new ResizeObserver(function () {
        var b = document.body, cs = getComputedStyle(b);
        var h = Math.ceil(b.getBoundingClientRect().height + (parseFloat(cs.marginTop) || 0) + (parseFloat(cs.marginBottom) || 0));
        if (h !== last) { last = h; core.post({ t: 'resize', height: h }); }
      }).observe(document.body);
    }
  });
  window.rp = core.rp;
})();
`.replace('/*__CONSOLE__*/', CONSOLE_CAPTURE)

/** Runs inside a script Worker, after SDK_CORE; the user's script is appended after this. */
export const WORKER_BOOT = String.raw`
var core = createRp({ post: function (m) { self.postMessage(m); } });
/*__CONSOLE__*/
self.rp = core.rp;
self.onmessage = function (e) { core.dispatch(e.data); };
self.addEventListener('error', function (e) { core.log('error', [e.message || 'Error']); });
self.addEventListener('unhandledrejection', function (e) { core.log('error', ['Unhandled rejection: ' + String((e.reason && e.reason.message) || e.reason)]); });
`.replace('/*__CONSOLE__*/', CONSOLE_CAPTURE)

/** Hidden-iframe bootstrap that spawns the Worker and relays between it and the host port. `__WORKER_SOURCE__` is replaced with a JSON string. */
export const SCRIPT_RELAY_BOOT = String.raw`
(function () {
  var port = null;
  window.addEventListener('message', function (e) {
    if (port || e.source !== window.parent || !e.data || e.data.t !== 'init' || !e.ports || !e.ports[0]) return;
    port = e.ports[0];
    var source = __WORKER_SOURCE__;
    var worker;
    try {
      worker = new Worker(URL.createObjectURL(new Blob([source], { type: 'text/javascript' })));
    } catch (err) {
      port.postMessage({ t: 'log', level: 'error', text: 'Could not start the script worker: ' + String(err && err.message || err) });
      return;
    }
    worker.onmessage = function (ev) { port.postMessage(ev.data); };
    worker.onerror = function (ev) { port.postMessage({ t: 'log', level: 'error', text: 'Script error: ' + (ev.message || 'unknown') }); };
    port.onmessage = function (ev) { worker.postMessage(ev.data); };
    worker.postMessage({ t: 'init', info: e.data.info });
  });
})();
`
