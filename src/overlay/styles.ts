// All overlay styling lives inside the shadow root; nothing leaks into the page.
export const CSS = `
:host { all: initial; }
* { box-sizing: border-box; }
[hidden] { display: none !important; }
.ui {
  --accent: #e8833a;
  --accent-strong: #f0954f;
  --surface: rgba(24, 24, 27, .94);
  --raised: rgba(255, 255, 255, .06);
  --hover: rgba(255, 255, 255, .1);
  --line: rgba(255, 255, 255, .09);
  --text: #f4f4f5;
  --muted: #a1a1aa;
  --faint: #71717a;
  --danger: #f87171;
  --ok: #4ade80;
  --shadow: 0 0 0 .5px rgba(0,0,0,.5), 0 12px 32px -6px rgba(0,0,0,.45), 0 4px 10px -4px rgba(0,0,0,.3);
  --ease-out: cubic-bezier(.2, .8, .2, 1);
  font: 13px/1.45 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  color: var(--text);
  -webkit-font-smoothing: antialiased;
}
button { font: inherit; color: inherit; cursor: pointer; }
button:focus-visible, textarea:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
kbd {
  font: 500 11px/1 ui-sans-serif, system-ui, -apple-system, sans-serif; color: var(--muted);
  background: var(--raised); border: 1px solid var(--line); border-radius: 5px; padding: 3px 5px;
}
.icon { display: inline-flex; flex: none; }
.icon svg { display: block; }

.box { position: fixed; pointer-events: none; border-radius: 4px; }
.hover-box { border: 1.5px dashed var(--accent); background: rgba(232, 131, 58, .06); }
.sel-box { border: 2px solid var(--accent); border-radius: 5px; background: rgba(232, 131, 58, .08); }
.batch-box { border: 1.5px solid rgba(232, 131, 58, .7); border-radius: 5px; }
.hover-label {
  position: fixed; pointer-events: none; background: var(--accent); color: #fff;
  font: 500 11px/1.3 ui-monospace, SFMono-Regular, Menlo, monospace;
  padding: 3px 7px; border-radius: 5px; white-space: nowrap; max-width: 60vw;
  overflow: hidden; text-overflow: ellipsis; box-shadow: 0 2px 8px rgba(0,0,0,.2);
}

.marker {
  position: fixed; width: 20px; height: 20px; margin: 0; padding: 0; border: 2px solid #fff; border-radius: 50%;
  background: var(--accent); color: #fff; font: 600 10px/16px system-ui, sans-serif; text-align: center;
  box-shadow: 0 2px 6px rgba(0,0,0,.3);
}
.marker .x { display: none; }
.marker:hover .n, .marker:focus-visible .n { display: none; }
.marker:hover .x, .marker:focus-visible .x { display: inline; }

/* Bubble: header (element), textarea, toolbar (icon actions + send). */
.bubble {
  position: fixed; width: 340px; max-width: calc(100vw - 16px);
  background: var(--surface); color: var(--text); border-radius: 14px; padding: 6px;
  border: 1px solid var(--line); box-shadow: var(--shadow);
  -webkit-backdrop-filter: blur(16px) saturate(1.4); backdrop-filter: blur(16px) saturate(1.4);
  transform-origin: top left; animation: wi-pop 160ms var(--ease-out);
}
@keyframes wi-pop { from { opacity: 0; transform: translateY(4px) scale(.97); } }
.bubble-head { display: flex; align-items: center; gap: 6px; padding: 2px 2px 6px 8px; }
.el-name {
  flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  font: 11.5px/1.3 ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--muted);
}
.bubble textarea {
  display: block; width: 100%; min-height: 68px; max-height: 168px; resize: none; margin: 0;
  background: var(--raised); border: 1px solid var(--line); border-radius: 10px; padding: 9px 11px;
  color: var(--text); font: 13px/1.45 ui-sans-serif, system-ui, -apple-system, sans-serif;
  transition: border-color 120ms, background-color 120ms, box-shadow 120ms;
}
.bubble textarea:focus { outline: none; border-color: rgba(232, 131, 58, .7); background: rgba(255,255,255,.08); box-shadow: 0 0 0 3px rgba(232, 131, 58, .18); }
.bubble textarea::placeholder { color: var(--faint); }
.bubble textarea[readonly] { opacity: .6; }
.bubble .err { color: var(--danger); font-size: 12px; padding: 6px 8px 0; }
.bubble-bar { display: flex; align-items: center; gap: 8px; padding: 6px 0 0; }
.actions { display: flex; gap: 2px; }
.bubble-bar .hint { margin-left: auto; color: var(--faint); font-size: 11px; white-space: nowrap; }

.icon-btn {
  position: relative; display: inline-flex; align-items: center; justify-content: center;
  width: 32px; height: 32px; margin: 0; padding: 0; border: 0; border-radius: 8px;
  background: transparent; color: var(--muted);
  transition: background-color 120ms, color 120ms, transform 120ms var(--ease-out);
}
.icon-btn:hover:not(:disabled) { background: var(--hover); color: var(--text); }
.icon-btn:active:not(:disabled) { transform: scale(.94); }
.icon-btn.danger:hover:not(:disabled) { background: rgba(248, 113, 113, .14); color: var(--danger); }
.icon-btn.close { width: 26px; height: 26px; border-radius: 7px; color: var(--faint); }
.icon-btn.primary { background: var(--accent); color: #fff; }
.icon-btn.primary:hover:not(:disabled) { background: var(--accent-strong); color: #fff; }
.icon-btn:disabled { opacity: .4; cursor: default; }
.busy .icon-btn.primary { opacity: .7; }

/* Tooltips: quick on hover (short delay), immediate on keyboard focus. */
[data-tip]::after {
  content: attr(data-tip); position: absolute; left: 50%; bottom: calc(100% + 8px); z-index: 1;
  transform: translate(-50%, 3px); opacity: 0; pointer-events: none; white-space: nowrap;
  background: #fafafa; color: #18181b; font: 500 12px/1.2 ui-sans-serif, system-ui, -apple-system, sans-serif;
  padding: 6px 8px; border-radius: 7px; box-shadow: 0 6px 16px rgba(0,0,0,.3);
  transition: opacity 120ms, transform 120ms var(--ease-out);
}
.actions .icon-btn:first-child[data-tip]::after { left: 0; transform: translate(0, 3px); }
.icon-btn.primary[data-tip]::after { left: auto; right: 0; transform: translate(0, 3px); }
[data-tip]:hover::after { opacity: 1; transform: translate(-50%, 0); transition-delay: 350ms; }
[data-tip]:focus-visible::after { opacity: 1; transform: translate(-50%, 0); }
.actions .icon-btn:first-child[data-tip]:hover::after,
.actions .icon-btn:first-child[data-tip]:focus-visible::after,
.icon-btn.primary[data-tip]:hover::after,
.icon-btn.primary[data-tip]:focus-visible::after { transform: none; }
[data-tip]:disabled::after { display: none; }

.toggle {
  position: fixed; left: 12px; bottom: 12px; display: inline-flex; align-items: center; gap: 7px;
  background: var(--surface); color: var(--text); border: 1px solid var(--line);
  border-radius: 999px; padding: 6px 7px 6px 10px; font-size: 12.5px; font-weight: 500; box-shadow: var(--shadow);
  -webkit-backdrop-filter: blur(16px); backdrop-filter: blur(16px);
  transition: background-color 120ms, border-color 120ms, transform 120ms var(--ease-out);
}
.toggle:hover { background: rgba(39, 39, 42, .96); }
.toggle:active { transform: scale(.97); }
.toggle .icon { color: var(--muted); }
.toggle.beside-next { left: 66px; bottom: 26px; }
.toggle[aria-pressed="true"] { border-color: rgba(232, 131, 58, .6); }
.toggle[aria-pressed="true"] .icon { color: var(--accent); }

.stack {
  position: fixed; right: 12px; bottom: 12px; width: 260px;
  display: flex; flex-direction: column; gap: 6px; align-items: stretch;
}
.batch, .pill {
  background: var(--surface); color: var(--text); border: 1px solid var(--line); border-radius: 12px;
  padding: 8px 10px; font-size: 12px; box-shadow: var(--shadow);
  -webkit-backdrop-filter: blur(16px); backdrop-filter: blur(16px);
}
.batch { display: flex; align-items: center; gap: 4px; }
.batch .sep { color: var(--faint); }
.batch .send {
  margin-left: auto; background: var(--accent); color: #fff; border: 0; border-radius: 7px; padding: 4px 10px;
  font-size: 12px; font-weight: 500; transition: background-color 120ms;
}
.batch .send:hover:not(:disabled) { background: var(--accent-strong); }
.batch .send:disabled { opacity: .6; cursor: default; }
.batch .err { color: var(--danger); margin-left: 6px; }
.pill-head {
  display: flex; align-items: center; width: 100%; background: none; border: 0; padding: 0; margin: 0;
  text-align: left; font-size: 12px;
}
.pill-line { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pill.off .pill-line { color: var(--danger); }
.dot { flex: none; width: 7px; height: 7px; border-radius: 50%; background: var(--accent); margin-right: 7px; }
.dot.idle { background: var(--faint); }
.dot.ok { background: var(--ok); }
.dot.live { animation: wi-pulse 1s infinite; }
@keyframes wi-pulse { 50% { opacity: .3; } }
.log {
  color: var(--muted); font: 11px/1.6 ui-monospace, SFMono-Regular, Menlo, monospace;
  border-top: 1px solid var(--line); margin-top: 7px; padding-top: 5px; max-height: 40vh; overflow: auto;
}
.log .h { font-family: ui-sans-serif, system-ui, sans-serif; color: var(--text); margin-top: 5px; }
.log .h:first-child { margin-top: 0; }
.q { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px; }
.q .s { color: var(--accent); }
.q .hint { flex-basis: 100%; color: var(--muted); font-family: ui-sans-serif, system-ui, sans-serif; }
.resend {
  background: var(--raised); border: 1px solid var(--line); border-radius: 5px; padding: 0 6px; font-size: 11px; color: var(--text);
}
.resend:hover { background: var(--hover); }
@media (prefers-reduced-motion: reduce) {
  .bubble { animation: none; }
  .dot.live { animation: none; }
  .icon-btn, .toggle, [data-tip]::after { transition: none; }
}
`
