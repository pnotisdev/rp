/** Dev-only: renders every VN placeholder scene gradient (day + night) to an HTML sheet for eyeballing. */
import { writeFileSync } from 'node:fs'
import { DEFAULT_BACKGROUNDS } from '../src/lib/vn/backgrounds.ts'
import { sceneGradient } from '../src/lib/vn/placeholder.ts'

const cells = DEFAULT_BACKGROUNDS.map((b) => {
  const day = sceneGradient(b.id)
  const night = sceneGradient(b.id, { night: true })
  return `<figure><div class="pair"><span style="background:${day}"></span><span style="background:${night}"></span></div><figcaption>${b.label}</figcaption></figure>`
}).join('\n')

const out = process.argv[2] ?? 'vn-gradients.html'
writeFileSync(out, `<!doctype html><meta charset=utf-8><title>VN scene gradients</title><style>
body{background:#0b0c10;color:#ddd;font:13px system-ui;margin:0;padding:24px}
h1{font-size:15px;font-weight:600;margin:0 0 4px}p{color:#888;margin:0 0 20px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:14px}
.pair{display:flex;gap:2px;height:110px;border-radius:10px;overflow:hidden}
.pair span{flex:1}
figcaption{margin-top:6px;color:#9a9aa5;font-size:11px}
</style><h1>VN placeholder scene gradients &mdash; day / night</h1><p>What VN mode paints for a background id with no uploaded art.</p><div class="grid">${cells}</div>`)
console.log('wrote', out)
