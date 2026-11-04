# web-inspect: plán implementace

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Cíl:** Claude Code mod. `/inspect <port>` spustí proxy před dev server a do stránky přidá overlay. V něm uživatel vybere element, napíše instrukci a ta i s přesným kontextem dorazí do běžící session v terminálu. Průběh práce Claude se zobrazuje zpět v prohlížeči.

**Architektura:** Repo má tři části. (1) **Mod** v `plugin/hooks/` (TypeScript, Claude Code ho načítá přímo, bez buildu) obsluhuje `/inspect`, polluje proxy, vkládá instrukce přes `$.prompt.submit({ asUser: true })` a posílá průběh. (2) **Proxy** (Node, `src/proxy/`, esbuild do `plugin/server/proxy.mjs`) přeposílá HTTP i WS na dev server, injektuje overlay do HTML a drží frontu a SSE kanál. (3) **Overlay** (vanilla TS v Shadow DOM, `src/overlay/`, esbuild do `plugin/server/overlay.js`). Mod spouští proxy přes malý launcher `plugin/server/launch.mjs` a proxy se sama ukončí, když jí přestanou chodit heartbeaty.

**Tech stack:** TypeScript, Node ≥ 20, `http-proxy` (HTTP+WS forwarding), `source-map-js`, esbuild, vitest + happy-dom (proxy a overlay), `claude plugin test` + `claude plugin validate` (mod).

**Spec:** `docs/superpowers/specs/2026-11-04-claude-inspect-design.md` (číst spolu s tímto plánem). Mockup UI: `docs/superpowers/specs/2026-11-04-overlay-mockup.html`.

## Global Constraints

- Claude Code ≥ **2.1.287** (mody). Uživatel má 2.1.318. Do README uvést testovanou verzi.
- Název pluginu **`web-inspect`** (validace odmítá jména začínající `claude-`). Repo/složka zůstává `claude-inspect`. Příkaz **`/inspect`**.
- Proxy poslouchá jen na **`127.0.0.1`**. Všechny `/__web-inspect/api/*` endpointy kromě `overlay.js` vyžadují token (hlavička `x-web-inspect-token`, u SSE query `?token=`). Token = 32 náhodných bajtů hex, generuje proxy při startu.
- Rezervovaný prefix proxy: **`/__web-inspect/`**. Vše ostatní jde beze změny na dev server.
- Výchozí port proxy **4000**, při obsazení další volný (4001, 4002, …, max 20 pokusů).
- Projekt uživatele se nemění: žádná instalace balíčků, žádné změny configu.
- Mod: hooks modul jen s importy relativních souborů uvnitř `plugin/` a `claude-code`. Každé volání `$` musí být napsané celé (`$.http.fetch(...)`), `$` jen do top-level funkcí ve stejném souboru (pravidla `claude plugin validate`).
- UI texty česky (viz mockup): `✏️ Upravit`, `🗑 Smazat`, `✨ Vylepšit`, `＋ Do dávky`, `Vlastní instrukce…`, `Dávka (N) · Odeslat`, `Čeká na schválení v terminálu`, `Hotovo`, `Přerušeno`, `Poslat znovu`, `◎ Výběr zapnut · Alt+C`.
- Přepínač výběru **Alt+C** (na macOS `event.code === 'KeyC' && event.altKey`, protože `event.key` je `ç`). **Esc** ruší výběr / vypíná režim.
- Barvy overlay: tmavé pozadí `#1c1c1e`, akcent `#d97706`.
- Build výstupy v `plugin/server/` se **commitují** (plugin musí jít nainstalovat bez buildu).

## Review Focus

1. **Streamované a komprimované HTML z Next.js:** overlay se vloží právě jednou, i když `<head>` přijde rozdělené přes dva chunky a upstream odpoví gzipem. Žádný chybný `content-length`. Pokrývá Task 2.
2. **HMR WebSockety:** upgrade včetně `sec-websocket-protocol` (Vite `vite-hmr`, Next `/_next/webpack-hmr`) projde obousměrně. Pokrývá Task 2.
3. **Proxy přežije session:** když Claude Code spadne nebo se zavře bez `session.end`, proxy se do 15 s po posledním heartbeatu sama ukončí. Pokrývá Task 3.
4. **Dvojí odeslání instrukce:** tick pollingu, který přijde, zatímco předchozí poll ještě běží, nesmí pollovat znovu. Vyzvednutí na proxy je atomické. Pokrývá Task 3 a Task 6.
5. **Obří výběr (`<body>`, celá sekce):** text se ořízne na 200 znaků a `outerHTML` na 600 znaků, zpráva tak zůstane kompaktní. Pokrývá Task 8.

---

## Struktura souborů

```
claude-inspect/
  package.json, tsconfig.json, vitest.config.ts, scripts/build.mjs
  plugin/                         ← adresář pro --plugin-dir
    .claude-plugin/plugin.json
    hooks/hooks.json
    hooks/register.ts             ← jediný soubor s on(...) a $ voláními
    hooks/lib/types.ts            ← sdílené typy (importuje i src/)
    hooks/lib/format.ts           ← Instruction → text zprávy pro Claude
    hooks/lib/queue.ts            ← čistý stavový automat fronty v modu
    hooks/lib/progress.ts         ← tool call → český popisek
    tests/*.test.ts               ← claude plugin test
    server/launch.mjs             ← ruční (malý), ne build
    server/proxy.mjs, server/overlay.js   ← build výstupy
  src/proxy/{server.ts, inject.ts, api.ts, store.ts, sourcemap.ts, main.ts}
  src/overlay/{index.ts, picker.ts, context.ts, react.ts, bubble.ts, batch.ts, pill.ts, api.ts, styles.ts}
  test/proxy/*.test.ts, test/overlay/*.test.ts
  README.md
```

## Sdílené typy (`plugin/hooks/lib/types.ts`, Task 1, používají všechny tasky)

```ts
export type SourceLoc = { file: string; line: number; column?: number }
export type ElementContext = {
  text: string            // innerText, whitespace sjednocený, max 200 znaků + '…'
  tag: string             // 'span'
  attrs: Record<string, string> // id, class, role, aria-label, href, src, alt, type, name, data-testid
  domPath: string         // 'main > section#pricing > div.plans > div.plan:nth-child(2) > span.badge'
  selector: string        // nejkratší unikátní CSS selektor (document.querySelectorAll(sel).length === 1)
  components: string[]    // React komponenty od nejbližší ven, max 5: ['PlanCard','Pricing','Page']
  source?: SourceLoc      // soubor:řádek, pokud zjistitelné (relativně k rootu projektu, když jde)
  sectionHeading?: string // nejbližší nadpis sekce
  outerHTML: string       // max 600 znaků + '…'
}
export type InstructionItem = { instruction: string; element: ElementContext }
export type Instruction = { id: string; createdAt: number; pageUrl: string; items: InstructionItem[] }
export type InstructionStatus = 'queued' | 'sent' | 'running' | 'done' | 'aborted' | 'held'
export type ProgressKind = 'tool' | 'waiting-permission' | 'turn-done' | 'turn-aborted' | 'info'
export type ProgressEvent = { kind: ProgressKind; label: string; instructionId?: string; at: number }
export type QueueEntry = { id: string; status: InstructionStatus; summary: string } // summary = první instrukce, max 60 znaků
export type Snapshot = { queue: QueueEntry[]; progress: ProgressEvent[] } // progress = posledních 20
export type LaunchInfo = { port: number; token: string; pid: number; target: number }
```

## HTTP API proxy (Task 3 implementuje, Tasky 5–10 konzumují)

Prefix `/__web-inspect`. Tělo i odpovědi JSON.

| Metoda a cesta | Kdo volá | Tělo → odpověď |
|---|---|---|
| `GET /overlay.js?token=…` | stránka | bundle overlay (bez kontroly tokenu) |
| `POST /api/instructions` | overlay | `{ pageUrl, items }` → `{ id }` (status `queued`) |
| `POST /api/resend` | overlay | `{ id }` → `{ ok: true }`: instrukci `aborted`/`held` vrátí na začátek fronty jako `queued` |
| `GET /api/events?token=…` | overlay | SSE, každá změna = `event: snapshot` + `data: Snapshot`. Při připojení se pošle hned. |
| `POST /api/poll` | mod | `{ canTake: boolean }` → `{ instruction: Instruction \| null }`. Vždy to je heartbeat. Při `canTake` atomicky vezme první `queued` a označí ho `sent`. |
| `POST /api/status` | mod | `{ id, status }` → `{ ok: true }` |
| `POST /api/progress` | mod | `ProgressEvent` → `{ ok: true }` (také heartbeat) |
| `POST /api/resolve-source` | overlay | `{ url, line, column }` → `SourceLoc \| null` |
| `POST /api/shutdown` | mod | `{}` → `{ ok: true }`, pak `process.exit(0)` |

Špatný nebo chybějící token = `401`. Neznámé `id` = `404`.

---

### Task 1: Kostra repa, plugin, typy a formát zprávy

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore` (`node_modules/`, `.superpowers/`, `plugin/.claude-plugin/types/`)
- Create: `plugin/.claude-plugin/plugin.json` (`name: "web-inspect"`, `version: "0.1.0"`, `description`, `author: { name: "Ondřej Konařík" }`)
- Create: `plugin/hooks/hooks.json` (`{ "description": "web-inspect hooks module", "modules": ["./register.ts"] }`)
- Create: `plugin/hooks/register.ts` (zatím jen `session.start` → registrace `/inspect` s `argumentHint: '[port|stop]'` a `immediate: true` a `command.run` vracející `{ text: 'web-inspect: neaktivní' }`)
- Create: `plugin/hooks/lib/types.ts` (viz výše), `plugin/hooks/lib/format.ts`
- Test: `plugin/tests/format.test.ts`

**Interfaces:**
- Produces: `formatInstruction(i: Instruction): string`, `quickActionText(action: 'delete' | 'improve'): string`, všechny typy výše.

- [ ] **Step 1: Napsat padající test** `plugin/tests/format.test.ts` (import z `claude-code/testing`, unit test čisté funkce):
  - `formats a single delete instruction`: vstup = 1 item, instrukce `quickActionText('delete')`, element s `text: 'Nejoblíbenější'`, `tag: 'span'`, `attrs: { class: 'badge' }`, `domPath`, `selector: '#pricing .plan:nth-child(2) > .badge'`, `components: ['PlanCard','Pricing']`, `source: { file: 'src/components/PlanCard.tsx', line: 8 }`, `sectionHeading: 'Ceník'`, `pageUrl: 'http://localhost:4000/pricing'`. Očekávaný výstup **přesně**:
    ```
    [web-inspect] Instrukce z prohlížeče, stránka /pricing

    Smaž tento element.

    Element:
    - text: "Nejoblíbenější"
    - tag: <span class="badge">
    - sekce: "Ceník"
    - komponenta: PlanCard ← Pricing (src/components/PlanCard.tsx:8)
    - HTML cesta: main > section#pricing > div.plans > div.plan:nth-child(2) > span.badge
    - selektor: #pricing .plan:nth-child(2) > .badge
    - html: <span class="badge">Nejoblíbenější</span>
    ```
  - `formats a batch with numbered elements`: 2 items → hlavička `[web-inspect] Dávka 2 úprav z prohlížeče, stránka /` a bloky `1) <instrukce>` + odrážky, `2) …`, oddělené prázdným řádkem.
  - `omits missing fields`: bez `source`, `components: []`, bez `sectionHeading` → žádné řádky `komponenta:` ani `sekce:`. Pouze `source` bez komponent → `- zdroj: src/x.tsx:3`.
  - `quickActionText`: `'delete'` → `'Smaž tento element.'`, `'improve'` → `'Vylepši tento element (vzhled, texty, přístupnost) v duchu zbytku stránky.'`
- [ ] **Step 2:** `cd plugin && claude plugin test` → FAIL (`format.ts` neexistuje).
- [ ] **Step 3:** Implementovat `format.ts`. Cesta v hlavičce = `new URL(pageUrl).pathname + search`.
- [ ] **Step 4:** `cd plugin && claude plugin test` → PASS. `claude plugin validate ./plugin` → `✔ Validation passed`, řádek `hooks:` obsahuje `session.start, command.run{command=inspect}`.
- [ ] **Step 5:** Zjistit přesné typy pro tuto verzi: `claude --plugin-dir ./plugin` v interaktivní session zapíše `plugin/.claude-plugin/types/claude-code/index.d.ts`. Pokud to nejde spustit, požádej uživatele, ať to jednou udělá (`! claude --plugin-dir ./plugin`, pak `/exit`). V typech ověř a do komentáře v `register.ts` zapiš skutečné tvary: výsledek `$.prompt.submit`, `next.origin`, `$.plugin.name`/`root` (vlastnost, nebo funkce?), `$.session.id`, vstup `tool.call` (`e.tool`, `e.agentId`) a `turn.complete` (`e.isAborted`, `e.agentId`). Jakákoli odchylka od tohoto plánu platí podle typů.
- [ ] **Step 6:** `npm init` + devDeps `typescript esbuild vitest happy-dom @types/node`, deps `http-proxy source-map-js` (+ `@types/http-proxy`). `npx tsc --noEmit` projde.
- [ ] **Step 7: Commit** `feat: plugin skeleton, shared types, instruction formatter`

### Task 2: Proxy jádro (forwarding, WS, injekce)

**Files:**
- Create: `src/proxy/server.ts`, `src/proxy/inject.ts`
- Test: `test/proxy/forward.test.ts`, `test/proxy/inject.test.ts`

**Interfaces:**
- Produces: `createInjector(tag: string): Transform` (Node stream: vloží `tag` za první `<head…>`, a když `<head` nikde není, před `</body>`, jinak na konec). `createProxyServer(opts: { target: number; overlayTag: string; handleOwn: (req, res) => boolean }): http.Server` (bez `listen`). `handleOwn` vrací `true`, když požadavek obsloužil sám (prefix `/__web-inspect/`).

- [ ] **Step 1: Testy injektoru** (`inject.test.ts`): (a) `<html><head><title>` → tag hned za `<head>`. (b) `<head lang="cs">` s atributy. (c) chunky `['<html><he', 'ad><title>x</title>']` → vloženo právě jednou. (d) bez head, s `</body>` → před `</body>`. (e) dva výskyty `<head>` → vloženo jen jednou.
- [ ] **Step 2: Testy forwardingu** (`forward.test.ts`), upstream = lokální `http.Server` + `ws` server na náhodném portu:
  - HTML odpověď s gzipem (upstream `zlib.gzipSync`, `content-encoding: gzip`) → klient dostane dekomprimované HTML s tagem, bez `content-length` nebo se správnou délkou, bez `content-encoding`.
  - JSON a obrázek projdou bajtově beze změny, hlavičky zachované.
  - Upstream vidí `host: localhost:<target>`, a pokud přišel `origin`, má hodnotu `http://localhost:<target>`.
  - WebSocket upgrade s `sec-websocket-protocol: vite-hmr` → upstream ho vidí, zpráva projde oběma směry.
  - Upstream nedostupný → `502` s jednoduchou HTML hláškou `web-inspect: dev server na portu <target> neodpovídá`.
  - `handleOwn` vrátí true → upstream nic nedostane.
- [ ] **Step 3:** Ověřit, že testy padají (`npx vitest run test/proxy`).
- [ ] **Step 4: Implementace.** `http-proxy` s `selfHandleResponse: true`. U odpovědí `text/html` odstranit z requestu `accept-encoding` (a kdyby přesto přišel gzip/br/deflate, dekomprimovat přes `zlib`), smazat `content-length` a pipe přes `createInjector`. Ostatní odpovědi pipe beze změny. `ws: true` přes `server.on('upgrade')`. Host/Origin přepsat v `proxyReq` / `proxyReqWs`.
- [ ] **Step 5:** `npx vitest run test/proxy` → PASS.
- [ ] **Step 6: Commit** `feat(proxy): http/ws forwarding with html overlay injection`

### Task 3: Proxy API, fronta, SSE, heartbeat

**Files:**
- Create: `src/proxy/store.ts`, `src/proxy/api.ts`, `src/proxy/main.ts`
- Test: `test/proxy/store.test.ts`, `test/proxy/api.test.ts`

**Interfaces:**
- Consumes: `createProxyServer` (Task 2), typy (Task 1).
- Produces: `class InstructionStore { add(pageUrl, items): Instruction; take(): Instruction | null; setStatus(id, s): boolean; resend(id): boolean; pushProgress(ev): void; snapshot(): Snapshot; onChange(cb): () => void }`. `createApi(store, opts: { token: string; overlayJsPath: string; resolveSource; onShutdown: () => void; onHeartbeat: () => void })` vrací handler `handleOwn`. `main.ts` (CLI: `--target <port> --port <port> --cwd <dir> --ready-file <path>`) najde volný port, poslouchá na `127.0.0.1`, zapíše `LaunchInfo` JSON do `--ready-file` a spustí watchdog.

- [ ] **Step 1: Testy store:** `take()` vrací FIFO a označí `sent`. Druhé `take()` vrátí další, ne stejnou. `resend` na `aborted` dá instrukci na začátek jako `queued`, na `done` vrací false. `snapshot().progress` drží max 20 posledních. `summary` = první instrukce oříznutá na 60 znaků.
- [ ] **Step 2: Testy API** (přes skutečný server na náhodném portu): 401 bez tokenu a se špatným tokenem. `POST /api/instructions` → `GET /api/events` dostane snapshot s položkou `queued`. Dva souběžné `poll {canTake:true}` při jedné instrukci → přesně jeden dostane instrukci. `poll {canTake:false}` nic nevezme. `status` s neznámým id → 404. Watchdog: s `heartbeatTimeoutMs: 200` (injektovatelné kvůli testu) a bez heartbeatu se zavolá `onShutdown`, s heartbeatem každých 50 ms ne. Výchozí hodnoty: **15 000 ms** po posledním heartbeatu, **30 000 ms** grace po startu. `/__web-inspect/overlay.js` vrací JS i bez tokenu. `shutdown` zavolá `onShutdown`.
- [ ] **Step 3:** Ověřit FAIL.
- [ ] **Step 4:** Implementace. Injektovaný tag: `<script src="/__web-inspect/overlay.js?token=<token>" defer data-web-inspect></script>`.
- [ ] **Step 5:** Ověřit PASS.
- [ ] **Step 6: Commit** `feat(proxy): instruction queue api, sse, heartbeat watchdog`

### Task 4: Launcher a build

**Files:**
- Create: `scripts/build.mjs` (esbuild: `src/proxy/main.ts` → `plugin/server/proxy.mjs`, platforma node, bundle, ESM. `src/overlay/index.ts` → `plugin/server/overlay.js`, IIFE, minify), `plugin/server/launch.mjs`
- Test: `test/proxy/launch.test.ts`

**Interfaces:**
- Produces: `node plugin/server/launch.mjs --target <port> --cwd <projectDir> [--port <port>]` (`--cwd` předá proxy kvůli relativním cestám v Task 9) spustí `proxy.mjs` jako `detached` proces (`stdio` do `os.tmpdir()/web-inspect-<pid>.log`, `unref()`). Čeká na ready file nejvýš **5 s**, pak vypíše jeden řádek JSON `LaunchInfo` na stdout a skončí s kódem 0. Při chybě vypíše `{ "error": "…" }` a skončí s kódem 1. Mod volá `$.process.run`, které se vrátí, jakmile launcher skončí. Proto je launcher a ne `$.process.spawn` (spawn není v GitHub kopii typů a jeho životní cyklus není zdokumentovaný). Proxy se o svůj konec stará sama přes heartbeat.

- [ ] **Step 1: Test:** po `npm run build` spustit launcher proti fake upstreamu → stdout je validní `LaunchInfo`, `port >= 4000`, `GET /` přes proxy vrátí HTML s tagem. `POST /api/shutdown` → proces zanikne do 2 s. Obsazený port 4000 → launcher vrátí 4001. Neplatný `--target` → kód 1 a `error`.
- [ ] **Step 2:** Ověřit FAIL, implementovat, `npm run build && npx vitest run test/proxy/launch.test.ts` → PASS.
- [ ] **Step 3: Commit** (včetně `plugin/server/*.mjs|js`) `feat: proxy launcher and build`

### Task 5: Mod: `/inspect` start, stop, stav

**Files:**
- Modify: `plugin/hooks/register.ts`
- Test: `plugin/tests/inspect-command.test.ts`

**Interfaces:**
- Consumes: launcher CLI (Task 4), API (Task 3).
- Produces: v `register.ts` stav `active: LaunchInfo | null`, uložený i v `$.store` pod klíčem `proxy:<sessionId>`, aby přežil hot reload modu. Top-level helper `api($, path: string, body: unknown): Promise<any>` (POST na `http://127.0.0.1:<port>/__web-inspect/api/<path>` s hlavičkou tokenu).

Chování:
- `/inspect 3000` → `$.process.run(['node', <root>/server/launch.mjs, '--target', '3000', '--cwd', <cwd ze $.session.cwd()>], { timeoutMs: 10000 })`. Úspěch → `{ text: 'web-inspect: otevři http://localhost:4000 (proxy pro localhost:3000). Výběr v prohlížeči: Alt+C.' }` a `$.ui.status('inspect → :4000')`. Když už běží → nejdřív stop starého.
- `/inspect stop` → `api('shutdown')`, smazat stav, `$.ui.status(undefined)`, `{ text: 'web-inspect: vypnuto' }`.
- `/inspect` bez argumentu → `aktivní: http://localhost:4000 → :3000` nebo `neaktivní. Použij /inspect <port dev serveru>`.
- Neplatný port → `web-inspect: zadej port dev serveru, např. /inspect 3000`.
- Launcher selže nebo `node` chybí (process.run rejectne) → `web-inspect: nepodařilo se spustit proxy (<důvod>). Potřebuješ Node 20+.`
- `session.end` → `api('shutdown')` bez čekání na odpověď (rozpočet 1,5 s).

- [ ] **Step 1: Testy** se stuby `process.run` (vrací `LaunchInfo` JSON), `http.fetch`, `store.get/set`, `ui.status`, `command.register`, `session.start`. Pokryj každý řádek chování výše a assertuj na přesné texty.
- [ ] **Step 2:** FAIL → implementace → `cd plugin && claude plugin test` PASS → `claude plugin validate ./plugin` PASS.
- [ ] **Step 3: Commit** `feat(mod): /inspect start, stop and status`

### Task 6: Mod: polling, odesílání instrukcí, přerušení

**Files:**
- Create: `plugin/hooks/lib/queue.ts`
- Modify: `plugin/hooks/register.ts`
- Test: `plugin/tests/queue.test.ts` (čistý automat), `plugin/tests/delivery.test.ts` (přes hooky s `mock.clock`)

**Interfaces:**
- Produces: čistý reducer `step(state: QueueState, ev: QueueEvent): { state: QueueState; effects: Effect[] }`:
  - `QueueState = { phase: 'idle' | 'polling' | 'submitting' | 'running' | 'paused'; current?: Instruction }`
  - `QueueEvent = { type: 'tick' } | { type: 'polled'; instruction: Instruction | null } | { type: 'submitted' } | { type: 'submit-dropped'; reason: string } | { type: 'turn-complete'; isAborted: boolean } | { type: 'user-input' }`
  - `Effect = { type: 'poll'; canTake: boolean } | { type: 'submit'; text: string } | { type: 'status'; id: string; status: InstructionStatus } | { type: 'progress'; ev: Omit<ProgressEvent,'at'> }`

Pravidla (zakódovat v testech):
- `tick` v `idle` → `phase: 'polling'`, effect `poll(canTake: true)`. `tick` v `running`/`submitting`/`paused` → `poll(canTake: false)` (heartbeat), fáze se nemění. `tick` v `polling` → **žádný effect** (Review Focus 4).
- `polled` s instrukcí → `submitting`, effecty `submit(formatInstruction(i))` a `status(id,'sent')`. `polled` null → `idle`.
- `submitted` → `running`, `status(id,'running')`.
- `submit-dropped` s důvodem obsahujícím `the session was stopped and nobody has sent input since` nebo `was removed from the queue before it ran` → `paused`, `status(id,'held')`, progress `info` `Přerušeno – pokračuj zprávou v terminálu`. Instrukce zůstane v `current`.
- `turn-complete` v `running`: `isAborted: false` → `idle`, `status(id,'done')`, progress `turn-done` `Hotovo`. `isAborted: true` → `paused`, `status(id,'aborted')`, progress `turn-aborted` `Přerušeno`, `current` se smaže (žádné automatické znovuposlání).
- `user-input` v `paused`: pokud je `current` (held) → `submitting` a znovu `submit` stejného textu. Jinak → `idle`.

Napojení v `register.ts`: `$.clock.every(500, …)`, jen když je proxy aktivní. Effekt `submit` volá `$.prompt.submit({ text, asUser: true })` **bez await** v hooku a výsledek převede na `submitted` / `submit-dropped`. `turn.complete` jen pro `e.agentId === undefined`. `prompt.submit` hook: když událost nepochází od tohoto pluginu (`next.origin.plugin`, ověřeno v Task 1 krok 5), pošli `user-input`. Vždy `return next(e)`.

Poznámka ke specu: „Poslat znovu“ v overlay (`/api/resend`) vrátí instrukci do fronty, ale Claude Code po Esc odmítá vstup od pluginů, dokud uživatel nenapíše něco v terminálu. Overlay proto u přerušené instrukce ukazuje text `Pokračuj zprávou v terminálu` (Task 10).

- [ ] **Step 1:** Testy reduceru pro každé pravidlo výše (jeden test na pravidlo).
- [ ] **Step 2:** Integrační test `delivery.test.ts`: `mock.clock`, stub `http.fetch` (poll vrátí instrukci jednou, pak null), stub `prompt.submit` → `clock.advance(500)` → submit dostal přesně text z `formatInstruction`. Další `advance(500)` × 3 → submit zavolán jen jednou. `$.turn.complete({ …, isAborted: false })` → fetch dostal `status done`. Varianta s `prompt.submit` stubem vracejícím `{ drop: 'the session was stopped and nobody has sent input since' }` → status `held`.
- [ ] **Step 3:** FAIL → implementace → PASS → validate.
- [ ] **Step 4: Commit** `feat(mod): deliver browser instructions into the session`

### Task 7: Mod: průběh do overlay

**Files:**
- Create: `plugin/hooks/lib/progress.ts`
- Modify: `plugin/hooks/register.ts`
- Test: `plugin/tests/progress.test.ts`

**Interfaces:**
- Produces: `toolLabel(tool: string, input: Record<string, unknown>): string`:
  - `Read` → `čte <basename(file_path)>`
  - `Edit`/`Write`/`MultiEdit`/`NotebookEdit` → `upravuje <basename>`
  - `Bash` → `spouští <command, prvních 40 znaků>`
  - `Grep`/`Glob` → `hledá <pattern>`
  - `Agent`/`Task` → `spouští subagenta`
  - ostatní → `používá <tool>`

Napojení: `tool.call` (jen hlavní smyčka, `e.agentId === undefined`, jen když je proxy aktivní a fáze `running`) → `api('progress', { kind: 'tool', label, instructionId })`, nečekat, `return next(e)`. `tool.check`: `const r = await next(e)`. Když `r.decision === 'ask'` → progress `waiting-permission` `Čeká na schválení v terminálu`. Vrátit `r` a přidat `.catch` (validate hlásí gating hook bez catch). Chyby fetch spolknout, průběh nesmí nikdy blokovat ani shodit tool call.

- [ ] **Step 1:** Unit testy `toolLabel` (každý řádek výše). Hook test: `$.tool.call({ tool: 'Edit', file_path: '/x/src/Pricing.tsx' })` → fetch body `{ kind:'tool', label:'upravuje Pricing.tsx' }`. `tool.check` stub vracející `{ decision: 'ask' }` → progress `waiting-permission`. Fetch, který rejectne → tool call stejně vrátí výsledek stubu.
- [ ] **Step 2:** FAIL → implementace → PASS → validate.
- [ ] **Step 3: Commit** `feat(mod): stream progress to the overlay`

### Task 8: Overlay: kontext elementu

**Files:**
- Create: `src/overlay/context.ts`
- Test: `test/overlay/context.test.ts` (vitest, `environment: 'happy-dom'`)

**Interfaces:**
- Produces: `buildElementContext(el: Element): Omit<ElementContext, 'components' | 'source'>`, `domPath(el): string`, `uniqueSelector(el): string`, `sectionHeading(el): string | undefined`.

Pravidla:
- `domPath`: od nejbližšího `main`/`body` dolů (bez `html` a `body`, kromě případu, kdy element je přímo v body). Segment = `tag` + `#id`, když je id, jinak + první dvě třídy (`.a.b`), a když má rodič víc sourozenců stejného tagu, přidá se `:nth-child(n)`. Třídy, které vypadají generovaně (`/^(css|sc|jsx|emotion)-[\w-]+$/` nebo obsahují `__` s hashem), se vynechají.
- `uniqueSelector`: zkoušet postupně `#id`, `[data-testid=…]`, pak zkracovat `domPath` zleva, dokud selektor zůstává unikátní.
- `sectionHeading`: projít předky. U každého `section`/`article`/`header`/`footer`/`[role=region]` vzít `aria-label`, nebo první `h1–h3` uvnitř. Jinak nejbližší předchozí `h1–h3` v pořadí dokumentu. Výsledek oříznout na 80 znaků.
- `text` a `outerHTML` limity viz typy (Review Focus 5). Do `attrs` jen allowlist z typů.
- Elementy overlay (uvnitř hostu `[data-web-inspect-host]`) se nikdy nevybírají (kontroluje picker v Task 10).

- [ ] **Step 1:** Testy na fixture HTML z mockupu (Ceník, tři plány, badge): přesný `domPath` `main > section#pricing > div.plans > div.plan:nth-child(2) > span.badge`, unikátní `selector`, `sectionHeading === 'Ceník'`. Generované třídy se vynechají. `<body>` s 10 000 znaky textu → `text.length <= 201`, `outerHTML.length <= 601`.
- [ ] **Step 2:** FAIL → implementace → PASS.
- [ ] **Step 3: Commit** `feat(overlay): element context extraction`

### Task 9: Overlay: React komponenty a zdroj

**Files:**
- Create: `src/overlay/react.ts`, `src/proxy/sourcemap.ts`
- Modify: `src/proxy/api.ts` (`resolve-source`)
- Test: `test/overlay/react.test.ts`, `test/proxy/sourcemap.test.ts`

**Interfaces:**
- Produces: `reactInfo(el: Element): { components: string[]; source?: SourceLoc; stackFrame?: { url: string; line: number; column: number } }`, `resolveSource(url, line, column): Promise<SourceLoc | null>` (proxy).

Postup v `reactInfo`:
1. Najít klíč `__reactFiber$*` na elementu (případně na nejbližším předkovi, který ho má).
2. Projít `fiber.return` a sbírat `type.displayName || type.name` u funkčních a třídních komponent (`typeof type === 'function'`, nebo `type.render` pro forwardRef / `type.type` pro memo). Vynechat jména začínající malým písmenem, interní Next.js komponenty (`/^(InnerLayoutRouter|OuterLayoutRouter|RedirectBoundary|NotFoundBoundary|ErrorBoundary|LoadingBoundary|ScrollAndFocusHandler|RenderFromTemplateContext|HotReload|Router|AppRouter|ServerRoot)$/`) a jména končící `Provider`/`Context`. Max 5.
3. Zdroj: (a) `fiber._debugSource` (React ≤ 18) → `{ fileName, lineNumber, columnNumber }`. (b) Jinak `fiber._debugStack` (React 19, `Error`) → `.stack` rozparsovat a vzít první rámec, jehož URL neobsahuje `node_modules`, `react-dom`, `react.development`, `/_next/static/chunks/` (framework) → `stackFrame`. Overlay pak zavolá `/api/resolve-source`.
4. `resolveSource` v proxy: stáhne `url` přes upstream (přepsat host na target). Najde `//# sourceMappingURL=` (inline `data:` i externí) a namapuje přes `source-map-js` na `{ source, line, column }`. Normalizace `file`: odstranit `webpack://_N_E/`, `webpack:///`, `file://`, prefix `./`, query `?t=…`, a když absolutní cesta začíná na cwd projektu, udělat ji relativní (cwd dostane proxy z launcheru `--cwd`, viz Task 4). Když cokoli selže → `null`.
5. Overlay to celé nesmí nechat spadnout: try/catch, fallback `components: []`.

- [ ] **Step 1:** Testy `reactInfo` s ručně postaveným falešným fiber stromem: `_debugSource` varianta, `_debugStack` varianta (stack s rámci `react-dom` a `http://localhost:4000/src/components/PlanCard.tsx?t=1:8:10` → vybere PlanCard rámec), filtr Next.js interních jmen, element bez fiberu → `{ components: [] }`.
- [ ] **Step 2:** Testy `resolveSource`: fake upstream servíruje JS s inline sourcemapou vygenerovanou v testu (`SourceMapGenerator`) → `{ file: 'src/components/PlanCard.tsx', line: 8 }`. Externí `.map`. JS bez mapy → `null`. Upstream 404 → `null`.
- [ ] **Step 3:** FAIL → implementace → PASS.
- [ ] **Step 4: Commit** `feat: react component and source resolution`

### Task 10: Overlay UI

**Files:**
- Create: `src/overlay/{index.ts, picker.ts, bubble.ts, batch.ts, pill.ts, api.ts, styles.ts}`
- Test: `test/overlay/ui.test.ts` (happy-dom)

**Interfaces:**
- Consumes: `buildElementContext` (Task 8), `reactInfo` + `/api/resolve-source` (Task 9), API (Task 3).
- Produces: `mountOverlay(opts: { token: string; doc?: Document }): { destroy(): void }`. `index.ts` čte token z `document.currentScript.src` a volá `mountOverlay` jednou (guard `window.__webInspect`).

Chování (podle mockupu a specu, sekce „UI v prohlížeči“):
- Host `<div data-web-inspect-host>` na konci `body` s `attachShadow({ mode: 'open' })`, `z-index: 2147483647`. Styly jen uvnitř shadow root.
- Tlačítko vlevo dole: `◎ Výběr vypnut · Alt+C` / `◎ Výběr zapnut · Alt+C`. Alt+C (podle `event.code`) přepíná. Esc: když je otevřená bublina, zavře ji. Jinak vypne režim.
- V režimu výběru: hover → čárkovaný obrys `#d97706` (absolutně pozicovaný box v shadow root, ne outline na prvku stránky) + štítek `tag.třída · Komponenta (soubor:řádek)`, nebo jen `tag.třída`. `pointerdown`/`mousedown`/`click`/`mouseup` v capture fázi na `window` → `preventDefault` + `stopImmediatePropagation`, takže stránka klik nedostane. Události nad hostem overlay se ignorují.
- Klik → plný obrys + bublina u elementu (pod ním, a když se nevejde, nad ním, v rámci viewportu): tlačítka `✏️ Upravit` (předvyplní pole `Uprav: ` a fokusne ho), `🗑 Smazat` (odešle hned `quickActionText('delete')`), `✨ Vylepšit` (předvyplní `quickActionText('improve')` a fokusne), `＋ Do dávky` (přidá s textem z pole jako poznámkou, nebo s `Uprav dle potřeby.`). Pole `Vlastní instrukce… (⏎ pošle hned)`, Enter odešle a Shift+Enter dělá nový řádek.
- Odeslání: `POST /api/instructions { pageUrl: location.href, items }`. Bublina se zavře a režim zůstane zapnutý.
- Dávka: položky v `sessionStorage['web-inspect:batch']` (přežije reload a HMR) a na stránce očíslované značky u elementů (pozice se přepočítá na scroll/resize, element se znovu najde podle `selector`). Pilulka: `Dávka (N) · Odeslat`, odeslání = jedna instrukce s N items a vyprázdnění dávky. U každé položky jde dávku zrušit (× u značky).
- Pilulka průběhu vpravo dole přes `EventSource('/__web-inspect/api/events?token=…')`. Sbalená ukazuje jednu řádku: běžící instrukci + poslední `tool` label (`Claude: upravuje Pricing.tsx…`), nebo `Čeká na schválení v terminálu`, `Hotovo`, `Ve frontě: N`, `Přerušeno`. Klik ji rozbalí a ukáže posledních 8 událostí a frontu. U `aborted` je tlačítko `Poslat znovu` (`/api/resend`) a u `held`/`aborted` text `Pokračuj zprávou v terminálu`. Při ztrátě SSE spojení: `web-inspect: proxy neběží` (EventSource se reconnectuje sám).

- [ ] **Step 1: Testy** (happy-dom, `fetch` a `EventSource` mockované):
  - Alt+C zapne režim a klik na badge neprojde k `onclick` stránky.
  - Klik otevře bublinu se čtyřmi akcemi a polem.
  - `🗑 Smazat` → `fetch` s `items[0].instruction === 'Smaž tento element.'` a `element.domPath` z fixture.
  - Enter v poli odešle vlastní text, Shift+Enter ne.
  - 2× `＋ Do dávky` → `sessionStorage` má 2 položky, pilulka ukazuje `Dávka (2) · Odeslat`, odeslání pošle 1 request se 2 items a vyprázdní storage.
  - Esc zavře bublinu, druhý Esc vypne režim.
  - Snapshot přes SSE s `running` + progress `upravuje Pricing.tsx` → pilulka obsahuje `upravuje Pricing.tsx`. Snapshot s `aborted` → tlačítko `Poslat znovu`.
  - Klik na prvek overlay ho nevybere.
- [ ] **Step 2:** FAIL → implementace → PASS → `npm run build` (overlay.js aktualizován).
- [ ] **Step 3: Commit** `feat(overlay): picker, bubble, batch and progress pill`

### Task 11: End-to-end ověření a README

**Files:**
- Create: `README.md`, `examples/vite-react/` (minimální Vite + React 19 app s „Ceník“ sekcí z mockupu), `examples/next-app/` (minimální Next.js App Router se stejnou sekcí). Obojí s `.gitignore` pro `node_modules`.

- [ ] **Step 1:** `npm run build`, `npx vitest run`, `cd plugin && claude plugin test`, `claude plugin validate ./plugin --strict` → vše zelené.
- [ ] **Step 2:** Vite příklad: `npm run dev` (port 5173) a v jiném terminálu `claude --plugin-dir ./plugin`, pak `/inspect 5173`. V prohlížeči ověřit (Chrome přes claude-in-chrome nebo uživatel ručně): overlay se objeví, HMR funguje (změna souboru se projeví bez reloadu), Alt+C → klik na badge → `🗑 Smazat` → v terminálu se objeví zpráva ve formátu z Task 1 s `src/…:řádek`, Claude badge odstraní a pilulka ukáže `upravuje …` a pak `Hotovo`. Dávka 2 elementů projde jako jedna zpráva. Esc během práce → `Přerušeno`.
- [ ] **Step 3:** Totéž pro Next.js příklad (`next dev`, port 3000). Zaznamenat, jestli se zdroj (soubor:řádek) podařilo zjistit. Pokud ne, ověřit, že zpráva obsahuje aspoň komponentu, text a HTML cestu.
- [ ] **Step 4:** `/inspect stop` → proxy zanikne (`lsof -i :4000` prázdné). Ukončit Claude Code bez stop → proxy zanikne do 15 s.
- [ ] **Step 5:** README (česky): co to je, instalace (`claude --plugin-dir /cesta/claude-inspect/plugin`, případně `CLAUDE_CODE_PLUGIN_DIRS` v `~/.claude/settings.json` pro trvalé načítání), použití, testovaná verze Claude Code (2.1.318), Node ≥ 20. **Známá omezení:** redirecty na absolutní URL dev serveru (OAuth, `NEXTAUTH_URL`) overlay obejdou. Po Esc je potřeba napsat zprávu v terminálu, než budou další instrukce z prohlížeče pokračovat. Soubor:řádek nemusí být dostupný u Server Components v Next.js. Schvalování oprávnění zůstává v terminálu.
- [ ] **Step 6: Commit** `docs: readme, examples and e2e verification`
