"use strict";(()=>{var G="/__web-inspect";function z(n){let e=(t,r,i)=>fetch(`${G}${t}`,{method:"POST",headers:{"content-type":"application/json","x-web-inspect-token":n},body:JSON.stringify(r),signal:i});return{eventsUrl:`${G}/api/events?token=${encodeURIComponent(n)}`,async sendInstruction(t,r){let i=await e("/api/instructions",{pageUrl:t,items:r});if(!i.ok)throw new Error(`HTTP ${i.status}`);return await i.json()},async resend(t){try{return(await e("/api/resend",{id:t})).ok}catch{return!1}},async resolveSource(t,r=1500){let i=typeof AbortController=="function"?new AbortController:void 0,o,a=new Promise(p=>{o=setTimeout(()=>{i?.abort(),p(void 0)},r)}),d=(async()=>{try{let p=await e("/api/resolve-source",t,i?.signal);if(!p.ok)return;let u=await p.json();return u&&typeof u.file=="string"&&typeof u.line=="number"?u:void 0}catch{return}})();try{return await Promise.race([d,a])}finally{clearTimeout(o)}}}}var he=["id","class","role","aria-label","href","src","alt","type","name","data-testid"],xe=/^(css|sc|jsx|emotion)-[\w-]+$/,ye=/__[\w-]*\d/;function q(n){return xe.test(n)||ye.test(n)}var F=n=>n.replace(/\s+/g," ").trim(),B=(n,e)=>n.length>e?n.slice(0,e)+"\u2026":n;function O(n){let e=globalThis.CSS?.escape;return e?e(n):n.replace(/^\d/,t=>`\\3${t} `).replace(/[^\w-]/g,t=>`\\${t}`)}function ve(n){let e=n.tagName.toLowerCase();if(n.id)return`${e}#${O(n.id)}`;let t=Array.from(n.classList).filter(o=>!q(o)).slice(0,2).map(o=>`.${O(o)}`).join(""),r=e+t,i=n.parentElement;return i&&Array.from(i.children).filter(a=>a.tagName===n.tagName).length>1&&(r+=`:nth-child(${Array.from(i.children).indexOf(n)+1})`),r}function V(n){let e=n.ownerDocument.body;if(n===n.ownerDocument.documentElement||n===e)return[n.tagName.toLowerCase()];let t=[],r=n;for(;r&&r!==e&&r!==n.ownerDocument.documentElement&&(t.unshift(r),r.tagName!=="MAIN");)r=r.parentElement;return t.map(ve)}function Ee(n){return V(n).join(" > ")}function ke(n){let e=n.ownerDocument,t=o=>{try{let a=e.querySelectorAll(o);return a.length===1&&a[0]===n}catch{return!1}};if(n.id){let o=`#${O(n.id)}`;if(t(o))return o}let r=n.getAttribute("data-testid");if(r){let o=`[data-testid="${r.replace(/["\\]/g,"\\$&")}"]`;if(t(o))return o}let i=V(n);for(let o=i.length-1;o>=0;o--){let a=i.slice(o).join(" > ");if(t(a))return a}return i.join(" > ")}var Q="h1,h2,h3",we="section,article,header,footer,[role=region]";function Ae(n){let e=r=>{let i=F(r??"");return i?i.slice(0,80):void 0};for(let r=n;r;r=r.parentElement){if(!r.matches(we))continue;let i=e(r.getAttribute("aria-label"))??e(r.querySelector(Q)?.textContent);if(i)return i}let t=Array.from(n.ownerDocument.querySelectorAll(Q));for(let r=t.length-1;r>=0;r--){let i=t[r];if(i!==n&&!n.contains(i)&&i.compareDocumentPosition(n)&4){let o=e(i.textContent);if(o)return o}}}function Se(n){let e=n.innerText;return(typeof e=="string"?F(e):"")||F(n.textContent??"")}function J(n){let e={};for(let i of he){let o=n.getAttribute(i);o!==null&&(e[i]=B(o,200))}let t={text:B(Se(n),200),tag:n.tagName.toLowerCase(),attrs:e,domPath:Ee(n),selector:ke(n),outerHTML:B(n.outerHTML,600)},r=Ae(n);return r&&(t.sectionHeading=r),t}var Le=new Set(["AppDevOverlay","AppDevOverlayErrorBoundary","AppRouter","AsyncMetadataOutlet","ClientPageRoot","ClientSegmentRoot","DevOverlay","DevRootHTTPAccessFallbackBoundary","DevRootNotFoundBoundary","ErrorBoundaryHandler","HTTPAccessFallbackBoundary","HTTPAccessFallbackErrorBoundary","InnerLayoutRouter","InnerScrollAndFocusHandler","LayoutRouter","MetadataBoundary","MetadataOutlet","MetadataTree","NotFoundErrorBoundary","OuterLayoutRouter","OutletBoundary","ReactDevOverlay","RedirectErrorBoundary","RenderFromTemplateContext","RootErrorBoundary","ScrollAndFocusHandler","SegmentViewNode","ServerRoot","ViewportBoundary","ViewportTree"]),Ne=new Set(["ErrorBoundary","Head","HotReload","LoadingBoundary","NotFoundBoundary","RedirectBoundary","Root","Router"]),Y=["node_modules","react-dom","react.development","react-server-dom","next/dist","/_next/static/chunks/webpack","/_next/static/chunks/framework","/_next/static/chunks/main","/_next/static/chunks/polyfills"];function Ie(n){for(let e=n;e;e=e.parentElement){let t=Object.keys(e).find(r=>r.startsWith("__reactFiber$"));if(t)return e[t]??null}return null}function Z(n,e=0){if(e>3||!n)return null;if(typeof n=="function"){let t=n,r=typeof t.displayName=="string"&&t.displayName?t.displayName:t.name;return typeof r=="string"&&r?r:null}if(typeof n=="object"){let t=n;return typeof t.render!="function"&&!t.type?null:typeof t.displayName=="string"&&t.displayName?t.displayName:Z(typeof t.render=="function"?t.render:t.type,e+1)}return null}var ee=n=>Y.some(e=>n.includes(e)),te=n=>/^[a-z][\w+.-]*:\/\//i.test(n)||n.startsWith("/");function Te(n){let e=n._debugSource;if(e&&typeof e.fileName=="string")return!e.fileName.includes("node_modules");let t=n._debugStack?.stack;if(typeof t!="string")return null;let r=oe(t).filter(i=>te(i.url));return r.length?r.some(i=>!ee(i.url)):null}function Ce(n){if(!Array.isArray(n))return null;let e=n.map(t=>Array.isArray(t)?t[1]:null).filter(t=>typeof t=="string"&&te(t));return e.length?e.some(t=>!ee(t)):null}function ne(n,e){return!/^[A-Z]/.test(n)||/(Provider|Context)$/.test(n)||Le.has(n)?!1:!Ne.has(n)||e()===!0}function Me(n,e){let t=n._debugInfo;if(!Array.isArray(t))return[];let r=[];for(let i=t.length-1;i>=0;i--){let o=t[i];if(!o||typeof o!="object"||typeof o.name!="string"||e.has(o))continue;e.add(o);let a=o.name;ne(a,()=>Ce(o.stack))&&r.push(a)}return r}function oe(n){let e=[];for(let t of n.split(`
`)){let r=t.trim(),i;if(r.startsWith("at ")){let a=r.slice(3),d=a.lastIndexOf(" (");i=a.endsWith(")")&&d>=0?a.slice(d+2,-1):a}else if(r.includes("@"))i=r.slice(r.indexOf("@")+1);else continue;let o=/^(.+):(\d+):(\d+)$/.exec(i);!o||/\s/.test(o[1])||e.push({url:o[1],line:Number(o[2]),column:Number(o[3])})}return e}var re="webpack-internal:///",$e=/^(?:about|rsc):\/\/React\/[^/]+\//;function Pe(n){let e=n.slice(re.length).replace(/[?#].*$/,"");for(e=e.replace(/^\([^)]*\)\//,"");e.startsWith("./");)e=e.slice(2);return e}function _e(n){let e=n._debugSource;if(e&&typeof e.fileName=="string"&&typeof e.lineNumber=="number"){let r={file:e.fileName,line:e.lineNumber};return typeof e.columnNumber=="number"&&(r.column=e.columnNumber),{source:r}}let t=n._debugStack?.stack;if(typeof t=="string"){let r=oe(t).find(a=>!Y.some(d=>a.url.includes(d)));if(!r)return null;let i=r.url.replace($e,""),o={line:r.line,column:r.column};return i.startsWith(re)?{source:{file:Pe(i),...o},stackFrame:r}:i.startsWith("file://")?{source:{file:decodeURIComponent(i.slice(7).replace(/[?#].*$/,"")),...o},stackFrame:r}:{stackFrame:i===r.url?r:{...r,url:i}}}return null}function D(n){try{let e=[],t=null,r=new Set,i=a=>{e.length<5&&e[e.length-1]!==a&&e.push(a)},o=Ie(n);for(let a=0;o&&a<500;a++,o=o.return??null){let d=o,p=typeof d.type=="string",u=p?null:Z(d.type),g=u!==null&&ne(u,()=>Te(d));g&&i(u);for(let l of Me(d,r))i(l);if(!t&&(p||g)&&(t=_e(o)),e.length>=5&&t)break}return{components:e,...t??{}}}catch{return{components:[]}}}var se=["pointerdown","mousedown","pointerup","mouseup","click","dblclick","auxclick","contextmenu"];function ie(n,e){return typeof n.composedPath=="function"?n.composedPath().includes(e):e.contains(n.target)}function ae(n,e){let t=typeof n.composedPath=="function"?n.composedPath()[0]:n.target,r=t&&t.nodeType===1?t:t?.parentElement??null;return!r||r===e.documentElement||r===e.body?null:r}function Re(n){let e=n.tagName.toLowerCase(),t=Array.from(n.classList).find(r=>!q(r));return t?`${e}.${t}`:e}function U(n){let e=D(n),t=e.source&&!e.stackFrame?`:${e.source.line}`:"",r=e.source?` (${e.source.file.split("/").pop()}${t})`:"",i=e.components[0];return Re(n)+(i?` \xB7 ${i}${r}`:r)}function _(n,e,t=2){n.style.left=`${e.left-t}px`,n.style.top=`${e.top-t}px`,n.style.width=`${e.width+t*2}px`,n.style.height=`${e.height+t*2}px`}function ce(n){let{win:e,doc:t,host:r,layer:i}=n,o=!1,a=null,d=null,p=0,u=t.createElement("div");u.className="box hover-box";let g=t.createElement("div");g.className="hover-label";let l=()=>{a=null,u.remove(),g.remove()},h=()=>{p=0;let s=a;if(!o||!s||!s.isConnected)return l();d!==s&&(g.textContent=U(s),d=s),u.isConnected||i.append(u,g);let f=s.getBoundingClientRect();_(u,f);let m=g.offsetWidth||0,b=f.top-20;g.style.top=`${b>=2?b:Math.min(f.bottom+4,e.innerHeight-20)}px`,g.style.left=`${Math.max(2,Math.min(f.left,e.innerWidth-m-2))}px`},w=s=>{if(!o)return;let f=ie(s,r)?null:ae(s,t);if(!f)return l();a=f,u.isConnected?p||(p=e.requestAnimationFrame(h)):h()},k=s=>{if(!(!o||ie(s,r))&&(s.preventDefault(),s.stopImmediatePropagation(),s.type==="click")){let f=ae(s,t);f&&n.onPick(f)}},x=s=>{s.relatedTarget||l()};e.addEventListener("mousemove",w,{capture:!0,passive:!0}),t.addEventListener("mouseout",x,!0);for(let s of se)e.addEventListener(s,k,!0);return{get active(){return o},setActive(s){o=s,s||l()},reposition:()=>a&&h(),destroy(){p&&e.cancelAnimationFrame(p),e.removeEventListener("mousemove",w,{capture:!0}),t.removeEventListener("mouseout",x,!0);for(let s of se)e.removeEventListener(s,k,!0);l()}}}function W(n){return n==="delete"?"Delete this element.":"Improve this element (visuals, copy, accessibility) in the style of the rest of the page."}var He={edit:'<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/>',delete:'<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><path d="M10 11v6"/><path d="M14 11v6"/>',improve:'<path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/><path d="M20 3v4"/><path d="M22 5h-4"/>',batch:'<path d="M11 12H3"/><path d="M16 6H3"/><path d="M16 18H3"/><path d="M18 9v6"/><path d="M21 12h-6"/>',send:'<path d="m5 12 7-7 7 7"/><path d="M12 19V5"/>',close:'<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',target:'<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/><path d="M12 1v4"/><path d="M12 19v4"/><path d="M1 12h4"/><path d="M19 12h4"/>'};function $(n,e){let t=n.createElement("span");return t.className="icon",t.setAttribute("aria-hidden","true"),t.innerHTML=`<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${He[e]}</svg>`,t}var De="Adjust as needed.",Be="Change this: ",Fe="Describe the change\u2026",X="Couldn\u2019t send. Is the proxy running?",le=8,R=8,Oe=168;function de(n){let{win:e,doc:t,layer:r,handlers:i}=n,o=null,a=t.createElement("div");a.className="box sel-box";let d=t.createElement("div");d.className="bubble",d.setAttribute("role","dialog"),d.setAttribute("aria-label","web-inspect: instruction for this element");let p=t.createElement("div");p.className="bubble-head";let u=t.createElement("span");u.className="el-name";let g=t.createElement("button");g.type="button",g.className="icon-btn close",g.setAttribute("aria-label","Close (Esc)"),g.append($(t,"close")),g.addEventListener("click",()=>N()),p.append(u,g);let l=t.createElement("textarea");l.rows=3,l.placeholder=Fe,l.setAttribute("aria-label","Instruction");let h=t.createElement("div");h.className="err",h.setAttribute("role","alert"),h.hidden=!0;let w=t.createElement("div");w.className="bubble-bar";let k=t.createElement("div");k.className="actions";let x=t.createElement("span");x.className="hint",x.textContent="\u23CE send \xB7 \u21E7\u23CE new line";let s=t.createElement("button");s.type="button",s.className="icon-btn primary",s.setAttribute("aria-label","Send"),s.dataset.tip="Send to Claude \u23CE",s.append($(t,"send")),w.append(k,x,s),d.append(p,l,h,w);let f=[s],m=(y,c,E,S,M="")=>{let A=t.createElement("button");A.type="button",A.className=`icon-btn ${M}`.trim(),A.setAttribute("aria-label",c),A.dataset.tip=E,A.append($(t,y)),A.addEventListener("click",S),f.push(A),k.append(A)},b=()=>l.value.trim(),v=()=>{l.style.height="auto",l.style.height=`${Math.min(l.scrollHeight,Oe)}px`},L=()=>{s.disabled=T||!b()},P=y=>{l.value=y,v(),L(),l.focus({preventScroll:!0}),l.setSelectionRange(y.length,y.length)},T=!1,C=y=>{T=y;for(let c of f)c.disabled=y;l.readOnly=y,d.classList.toggle("busy",y),L()},I=async(y,c)=>{let E=o;if(!(!E||T)){h.hidden=!0,C(!0);try{await y(E,c),o===E&&N()}catch{o===E&&(h.textContent=X,h.hidden=!1)}finally{C(!1)}}};m("edit","Edit","Edit: describe what to change",()=>P(Be)),m("delete","Delete","Delete: sends right away",()=>{I(i.send,W("delete"))},"danger"),m("improve","Improve","Improve: prefills a suggestion",()=>P(W("improve"))),m("batch","Add to batch","Add to batch: the text becomes its note",()=>{I(i.addToBatch,b()||De)}),s.addEventListener("click",()=>{b()&&I(i.send,b())}),l.addEventListener("input",()=>{v(),L()}),l.addEventListener("keydown",y=>{y.key!=="Enter"||y.shiftKey||y.isComposing||(y.preventDefault(),b()&&!T&&I(i.send,b()))});for(let y of["keydown","keyup","keypress"])d.addEventListener(y,c=>c.stopPropagation());function H(){if(!o)return;if(!o.isConnected)return N();let y=o.getBoundingClientRect();_(a,y);let c=d.offsetWidth||340,E=d.offsetHeight||160,S=e.innerHeight,M=e.innerWidth,A=y.bottom+le;A+E>S-R&&(A=y.top-E-le),A=Math.max(R,Math.min(A,S-E-R));let ge=Math.max(R,Math.min(y.left,M-c-R));d.style.top=`${A}px`,d.style.left=`${ge}px`}function N(){o=null,a.remove(),d.remove()}return{get target(){return o},open(y){o=y,u.textContent=U(y),u.title=u.textContent,l.value="",l.style.height="",h.hidden=!0,C(!1),r.append(a,d),H(),l.focus({preventScroll:!0})},close:N,reposition:H,destroy:N}}var K="web-inspect:batch";function ue(n){try{return n.sessionStorage}catch{return null}}function qe(n){try{let e=JSON.parse(ue(n)?.getItem(K)??"[]");return Array.isArray(e)?e.filter(t=>t&&typeof t.instruction=="string"&&t.element):[]}catch{return[]}}function j(n,e){try{let t=ue(n);if(!t)return;e.length?t.setItem(K,JSON.stringify(e)):t.removeItem(K)}catch{}}function pe(n){let{win:e,doc:t,layer:r,dock:i}=n,o=qe(e),a=!1,d=[],p=t.createElement("div");p.className="batch";let u=t.createElement("b"),g=t.createElement("span");g.className="sep",g.textContent=" \xB7 ";let l=t.createElement("button");l.type="button",l.className="send",l.textContent="Send";let h=t.createElement("span");h.className="err",h.setAttribute("role","alert"),h.textContent=X,h.hidden=!0,p.append(u,g,l,h),l.addEventListener("click",async()=>{if(a||!o.length)return;a=!0,l.disabled=!0,h.hidden=!0;let s=o;try{await n.send(s),o=o.filter(f=>!s.includes(f)),j(e,o),k()}catch{h.hidden=!1}finally{a=!1,l.disabled=!1}});let w=s=>{o=o.filter(f=>f!==s),j(e,o),k()};function k(){for(let s of d)s.box.remove(),s.marker.remove();d=o.map((s,f)=>{let m=t.createElement("div");m.className="box batch-box";let b=t.createElement("button");b.type="button",b.className="marker",b.setAttribute("aria-label",`Item ${f+1}: ${s.instruction}. Remove from batch`),b.title=`${s.instruction}
\xD7 remove from batch`;let v=t.createElement("span");v.className="n",v.textContent=String(f+1);let L=t.createElement("span");return L.className="x",L.textContent="\xD7",b.append(v,L),b.addEventListener("click",()=>w(s)),r.append(m,b),{box:m,marker:b}}),o.length?(u.textContent=`Batch (${o.length})`,p.isConnected||i.prepend(p)):p.remove(),x(),n.onChange()}function x(){d.forEach(({box:s,marker:f},m)=>{let b=null;try{b=t.querySelector(o[m].element.selector)}catch{}let v=b?.getBoundingClientRect(),L=!!v&&(v.width>0||v.height>0);s.hidden=f.hidden=!L,!(!v||!L)&&(_(s,v),f.style.left=`${Math.max(0,Math.min(v.right-9,e.innerWidth-18))}px`,f.style.top=`${Math.max(0,v.top-9)}px`)})}return k(),{get items(){return o},add(s){o=[...o,s],j(e,o),k()},reposition:x,destroy(){for(let s of d)s.box.remove(),s.marker.remove();d=[],p.remove()}}}var fe="Interrupted. Send a message in the terminal to continue";var Ue=new Set(["sent","running"]),We={queued:"queued",sent:"sent",running:"running",done:"done",aborted:"interrupted",held:"on hold"},Xe={tool:"\xB7","waiting-permission":"\u23F8","turn-done":"\u2713","turn-aborted":"\u2715",info:"\u2139"},je="web-inspect: proxy isn\u2019t running",Ke="Send a message in the terminal to continue",Ge="Queued. Send a message in the terminal to continue",ze=new Set(["turn-done","turn-aborted","info"]);function Qe(n){if(n.queue.some(t=>t.status==="held"))return!0;let e=[...n.progress].reverse().find(t=>ze.has(t.kind));return e?.kind==="turn-aborted"||e?.kind==="info"&&e.label===fe}function Ve(n){let e=n.progress[n.progress.length-1],t=[...n.queue].reverse().find(o=>Ue.has(o.status));if(t){if(e?.kind==="waiting-permission")return{text:"Waiting for approval in the terminal",tone:"wait"};let o=[...n.progress].reverse().find(a=>a.kind==="tool"&&a.instructionId===t.id);return{text:`Claude: ${o?o.label:"working"}\u2026`,tone:"live"}}let r=n.queue.filter(o=>o.status==="queued").length;if(r>0)return Qe(n)?{text:Ge,tone:"wait"}:{text:`Queued: ${r}`,tone:"wait"};let i=[...n.queue].reverse().find(o=>o.status==="done"||o.status==="aborted"||o.status==="held");return i?i.status==="done"?{text:"Done",tone:"ok"}:{text:"Interrupted",tone:"idle"}:e?{text:e.label,tone:"idle"}:null}function me(n){let{win:e,doc:t,dock:r,api:i}=n,o=null,a=!1,d=!1,p=t.createElement("div");p.className="pill",p.setAttribute("aria-live","polite");let u=(x,s,f)=>{let m=t.createElement(x);return m.className=s,f!==void 0&&(m.textContent=f),m};function g(){let x=a?{text:je,tone:"off"}:o&&Ve(o);if(!x){p.remove(),n.onChange();return}p.classList.toggle("off",a),p.replaceChildren();let s=u("button","pill-head");s.type="button",s.setAttribute("aria-expanded",String(d)),s.title=d?"Collapse":"Show progress";let f=u("span",`dot ${x.tone==="live"||x.tone==="wait"?"live":x.tone==="ok"?"ok":"idle"}`);s.append(f,u("span","pill-line",x.text)),s.addEventListener("click",()=>{d=!d,g()}),p.append(s),d&&o&&p.append(l(o)),p.isConnected||r.append(p),n.onChange()}function l(x){let s=u("div","log"),f=x.progress.slice(-8);if(f.length){s.append(u("div","h","Progress"));for(let m of f)s.append(u("div","ev",`${Xe[m.kind]??"\xB7"} ${m.label}`))}if(x.queue.length){s.append(u("div","h","Queue"));for(let m of x.queue){let b=u("div","q");if(b.append(u("span","s",We[m.status]??m.status),u("span","sum",m.summary)),m.status==="aborted"){let v=u("button","resend","Send again");v.type="button",v.addEventListener("click",async()=>{v.disabled=!0,await i.resend(m.id),v.isConnected&&(v.disabled=!1)}),b.append(v)}(m.status==="aborted"||m.status==="held")&&b.append(u("span","hint",Ke)),s.append(b)}}return s}let h=e.EventSource,w=h?new h(i.eventsUrl):null,k=x=>{try{o=JSON.parse(x.data),(!Array.isArray(o.queue)||!Array.isArray(o.progress))&&(o=null)}catch{return}a=!1,g()};return w&&(w.addEventListener("snapshot",k),w.onerror=()=>{a=!0,g()}),{destroy(){w?.close(),p.remove()}}}var be=`
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
`;function Je(n){let e=n;if(!e||typeof e.tagName!="string")return!1;let t=e.tagName.toUpperCase();if(t==="INPUT"||t==="TEXTAREA"||t==="SELECT"||e.isContentEditable)return!0;let r=typeof e.closest=="function"?e.closest("[contenteditable]"):null;return!!r&&r.getAttribute("contenteditable")?.toLowerCase()!=="false"}var Ye="Inspect",Ze="Inspecting";function et(n){let e=n;return/mac|iphone|ipad|ipod/i.test(e.userAgentData?.platform||e.platform||e.userAgent||"")}var tt=n=>n?"\u2318C":"Alt+C";function nt(n){let e=n.doc??document,t=e.defaultView??window,r=z(n.token),i=n.mac??et(t.navigator),o=tt(i),a=e.createElement("div");a.setAttribute("data-web-inspect-host",""),a.style.cssText="position:fixed;top:0;left:0;width:0;height:0;z-index:2147483647;";let d=a.attachShadow({mode:"open"}),p=e.createElement("style");p.textContent=be;let u=e.createElement("div");u.className="ui";let g=e.createElement("div"),l=e.createElement("button");l.type="button",l.className="toggle";let h=e.createElement("div");h.className="stack",u.append(g,l,h),d.append(p,u),e.body.append(a);async function w(c,E){let S=D(c),M=S.source;return S.stackFrame&&(M=await r.resolveSource(S.stackFrame)??S.source),{instruction:E,element:{...J(c),components:S.components,...M?{source:M}:{}}}}let k=pe({win:t,doc:e,layer:g,dock:h,send:async c=>{await r.sendInstruction(t.location.href,c)},onChange:()=>m()}),x=de({win:t,doc:e,layer:g,handlers:{send:async(c,E)=>{await r.sendInstruction(t.location.href,[await w(c,E)])},addToBatch:async(c,E)=>k.add(await w(c,E))}}),s=ce({win:t,doc:e,host:a,layer:g,onPick:c=>x.open(c)}),f=me({win:t,doc:e,dock:h,api:r,onChange:()=>m()});function m(){h.hidden=h.childElementCount===0}m();function b(c){s.setActive(c),c||x.close(),l.setAttribute("aria-pressed",String(c)),l.title=c?`Stop picking elements (${o})`:`Pick an element on the page (${o})`;let E=e.createElement("span");E.textContent=c?Ze:Ye;let S=e.createElement("kbd");S.textContent=o,l.replaceChildren($(e,"target"),E,S)}b(!1),l.addEventListener("click",()=>b(!s.active));let v=()=>{let c=t.getSelection?.();return!!c&&!c.isCollapsed&&c.toString()!==""},L=c=>c.code!=="KeyC"||c.ctrlKey||c.shiftKey?!1:c.altKey&&!c.metaKey?!0:i&&c.metaKey&&!c.altKey&&!v(),P=c=>{if(L(c)){if(c.repeat||Je(c.composedPath()[0]))return;c.preventDefault(),b(!s.active)}else if(c.key==="Escape"){if(c.isComposing)return;if(x.target)x.close();else if(s.active)b(!1);else return;c.preventDefault(),c.stopPropagation()}};t.addEventListener("keydown",P,!0);let T=()=>l.classList.toggle("beside-next",!!e.querySelector("nextjs-portal"));T();let C=new t.MutationObserver(T);C.observe(e.body,{childList:!0});let I=0,H=()=>{I=0,s.reposition(),x.reposition(),k.reposition()},N=()=>{I||(I=t.requestAnimationFrame(H))};t.addEventListener("scroll",N,{capture:!0,passive:!0}),t.addEventListener("resize",N,{passive:!0});let y=t.setInterval(()=>{!a.isConnected&&e.body&&(e.body.append(a),C.observe(e.body,{childList:!0})),T(),N()},1e3);return{destroy(){t.clearInterval(y),C.disconnect(),I&&t.cancelAnimationFrame(I),t.removeEventListener("keydown",P,!0),t.removeEventListener("scroll",N,{capture:!0}),t.removeEventListener("resize",N),s.destroy(),x.destroy(),k.destroy(),f.destroy(),a.remove()}}}function ot(){let e=(document.currentScript??document.querySelector("script[data-web-inspect]"))?.getAttribute("src");if(!e)return null;try{return new URL(e,location.href).searchParams.get("token")}catch{return null}}if(typeof window<"u"&&typeof document<"u"&&!window.__webInspect){let n=ot();if(n){let e=null,t=!1;window.__webInspect={destroy(){t=!0,e?.destroy(),delete window.__webInspect}};let r=()=>{t||(e=nt({token:n}))};document.body?r():document.addEventListener("DOMContentLoaded",r,{once:!0})}}})();
