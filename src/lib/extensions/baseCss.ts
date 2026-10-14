// Default stylesheet injected into every extension panel so plain HTML matches the app's flat look.

export const BASE_CSS = `
*{box-sizing:border-box}
html,body{margin:0;background:transparent}
body{padding:14px;color:rgb(var(--c-text));font:14px/1.55 'Inter Variable',ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;-webkit-font-smoothing:antialiased}
h1,h2,h3,h4{margin:0 0 .4em;line-height:1.25;font-weight:600}
h1{font-size:1.25rem}h2{font-size:1.05rem}h3{font-size:.95rem}
p{margin:0 0 .75em}
a{color:rgb(var(--c-accent))}
hr{border:0;height:1px;background:rgb(var(--c-border));margin:12px 0}
::selection{background:rgb(var(--c-accent)/.35)}
input[type=checkbox],input[type=radio],input[type=range]{accent-color:rgb(var(--c-accent))}
.rp-muted{color:rgb(var(--c-text-muted))}
.rp-label{font-size:12px;font-weight:500;color:rgb(var(--c-text-muted))}
.rp-stack{display:flex;flex-direction:column;gap:10px}
.rp-row{display:flex;align-items:center;gap:8px}
.rp-wrap{flex-wrap:wrap}
.rp-grow{flex:1;min-width:0}
.rp-center{display:flex;align-items:center;justify-content:center}
.rp-big{font-size:2rem;font-weight:600;font-variant-numeric:tabular-nums}
.rp-card{background:rgb(var(--c-bg-elevated));border:1px solid rgb(var(--c-border));border-radius:8px;padding:14px}
.rp-sunken{background:rgb(var(--c-bg-sunken));border-radius:6px;padding:10px}
.rp-btn{white-space:nowrap;appearance:none;border:1px solid rgb(var(--c-border));border-radius:6px;padding:6px 12px;background:transparent;color:rgb(var(--c-text));font:inherit;font-weight:500;cursor:pointer;transition:opacity .15s,transform .05s}
.rp-btn:hover{background:rgb(var(--c-bg-sunken))}
.rp-btn:active{transform:scale(.98)}
.rp-btn:disabled{opacity:.4;cursor:not-allowed}
.rp-btn.primary{background:rgb(var(--c-accent));border-color:transparent;color:rgb(var(--c-accent-text))}
.rp-btn.primary:hover{background:rgb(var(--c-accent));opacity:.88}
.rp-btn.ghost{border-color:transparent;color:rgb(var(--c-text-muted))}
.rp-btn.round{border-radius:6px}
.rp-input{width:100%;border:1px solid rgb(var(--c-border));outline:0;border-radius:6px;padding:6px 10px;background:rgb(var(--c-bg-elevated));color:rgb(var(--c-text));font:inherit;transition:border-color .15s}
.rp-input:focus{border-color:rgb(var(--c-accent)/.7)}
.rp-chip{display:inline-block;border-radius:5px;padding:1px 8px;background:rgb(var(--c-accent)/.12);color:rgb(var(--c-accent));font-size:12px;font-weight:500}
.rp-bar{height:8px;border-radius:4px;background:rgb(var(--c-bg-sunken));overflow:hidden}
.rp-bar>i{display:block;height:100%;background:rgb(var(--c-accent));border-radius:inherit;transition:width .3s}
`.trim()
