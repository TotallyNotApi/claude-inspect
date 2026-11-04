// All overlay styling lives inside the shadow root; nothing leaks into the page.
export const CSS = `
:host { all: initial; }
* { box-sizing: border-box; }
[hidden] { display: none !important; }
.ui {
  font: 12px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif;
  color: #eee;
  -webkit-font-smoothing: antialiased;
}
button { font: inherit; color: inherit; cursor: pointer; }
button:focus-visible, textarea:focus-visible { outline: 2px solid #d97706; outline-offset: 1px; }

.box { position: fixed; pointer-events: none; border-radius: 3px; }
.hover-box { border: 1px dashed #d97706; }
.sel-box { border: 2px solid #d97706; border-radius: 4px; }
.batch-box { border: 1px solid rgba(217,119,6,.7); border-radius: 4px; }
.hover-label {
  position: fixed; pointer-events: none; background: #d97706; color: #fff;
  font: 10px/1.3 ui-monospace, SFMono-Regular, Menlo, monospace;
  padding: 2px 5px; border-radius: 3px; white-space: nowrap; max-width: 60vw;
  overflow: hidden; text-overflow: ellipsis;
}

.marker {
  position: fixed; width: 18px; height: 18px; margin: 0; padding: 0; border: 0; border-radius: 50%;
  background: #d97706; color: #fff; font: 600 10px/18px system-ui, sans-serif; text-align: center;
  box-shadow: 0 1px 4px rgba(0,0,0,.3);
}
.marker .x { display: none; }
.marker:hover .n, .marker:focus-visible .n { display: none; }
.marker:hover .x, .marker:focus-visible .x { display: inline; }

.bubble {
  position: fixed; width: 304px; max-width: calc(100vw - 16px);
  background: #1c1c1e; color: #eee; border-radius: 8px; padding: 8px;
  box-shadow: 0 8px 24px rgba(0,0,0,.3); font-size: 11px;
}
.actions { display: flex; flex-wrap: wrap; gap: 4px; }
.chip {
  background: #2c2c2e; border: 1px solid #3a3a3c; border-radius: 5px; padding: 3px 7px; margin: 0;
  font-size: 11px; color: #eee; white-space: nowrap;
}
.chip:hover { background: #3a3a3c; border-color: #4a4a4c; }
.chip:disabled { opacity: .5; cursor: default; }
.bubble textarea {
  display: block; width: 100%; margin-top: 6px; min-height: 30px; max-height: 120px; resize: vertical;
  background: #2c2c2e; border: 1px solid #3a3a3c; border-radius: 5px; padding: 5px 7px;
  color: #eee; font: 11px/1.4 system-ui, -apple-system, sans-serif;
}
.bubble textarea::placeholder { color: #888; }
.bubble .err { color: #f87171; margin-top: 4px; }

.toggle {
  position: fixed; left: 12px; bottom: 12px; background: #1c1c1e; color: #eee; border: 0;
  border-radius: 20px; padding: 6px 11px; font-size: 11px; box-shadow: 0 4px 14px rgba(0,0,0,.25);
}
.toggle.beside-next { left: 66px; bottom: 26px; }
.toggle[aria-pressed="true"] { box-shadow: 0 0 0 1px #d97706, 0 4px 14px rgba(0,0,0,.25); }

.stack {
  position: fixed; right: 12px; bottom: 12px; width: 240px;
  display: flex; flex-direction: column; gap: 6px; align-items: stretch;
}
.batch, .pill {
  background: #1c1c1e; color: #eee; border-radius: 10px; padding: 7px 10px; font-size: 11px;
  box-shadow: 0 4px 14px rgba(0,0,0,.25);
}
.batch { display: flex; align-items: center; gap: 4px; }
.batch .sep { color: #9a9a9a; }
.batch .send {
  margin-left: auto; background: #d97706; color: #fff; border: 0; border-radius: 4px; padding: 2px 8px; font-size: 11px;
}
.batch .send:disabled { opacity: .6; cursor: default; }
.batch .err { color: #f87171; margin-left: 6px; }
.pill-head {
  display: flex; align-items: center; width: 100%; background: none; border: 0; padding: 0; margin: 0;
  text-align: left; font-size: 11px;
}
.pill-line { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pill.off .pill-line { color: #f87171; }
.dot { flex: none; width: 7px; height: 7px; border-radius: 50%; background: #d97706; margin-right: 6px; }
.dot.idle { background: #636366; }
.dot.ok { background: #34c759; }
.dot.live { animation: wi-pulse 1s infinite; }
@keyframes wi-pulse { 50% { opacity: .3; } }
@media (prefers-reduced-motion: reduce) { .dot.live { animation: none; } }
.log {
  color: #9a9a9a; font: 10px/1.6 ui-monospace, SFMono-Regular, Menlo, monospace;
  border-top: 1px solid #333; margin-top: 6px; padding-top: 4px; max-height: 40vh; overflow: auto;
}
.log .h { font-family: system-ui, sans-serif; color: #c7c7cc; margin-top: 4px; }
.log .h:first-child { margin-top: 0; }
.q { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px; }
.q .s { color: #d97706; }
.q .hint { flex-basis: 100%; color: #c7c7cc; font-family: system-ui, sans-serif; }
.resend {
  background: #2c2c2e; border: 1px solid #3a3a3c; border-radius: 4px; padding: 0 6px; font-size: 10px; color: #eee;
}
`
