# claude-inspect — návrh

Datum: 2026-11-04 · Stav: návrh ke schválení

## Záměr a proč

Při vývoji frontendu chce uživatel Claude Code říct „odeber tenhle label v téhle sekci“. Dnes to dělá tak, že agentovi ručně kopíruje nadpis sekce a text elementu, aby agent přesně věděl, o čem je řeč. Je to přesné, ale zdlouhavé.

`claude-inspect` je rozšíření Claude Code, které tohle nahradí ukázáním myší. Uživatel otevře svůj dev server přes proxy, klikne na element v prohlížeči, zvolí rychlou akci nebo napíše vlastní instrukci a ta i s přesným kontextem elementu dorazí do **té Claude Code session, kterou má právě otevřenou v terminálu**. Claude upraví kód, hot reload dev serveru změnu hned ukáže a overlay ve stránce mezitím zobrazuje, co Claude dělá.

Cílem je rychlost bez ztráty přesnosti: agent musí dostat stejně jednoznačnou „adresu“ jako dnes, jen bez ručního kopírování.

## Cíle

- Aktivace slash commandem v **jakékoli už běžící** interaktivní session: `/inspect <port>` (např. `/inspect 3000`), vypnutí `/inspect stop`. Nesmí vyžadovat speciální spouštěcí flagy `claude`.
- Proxy dev server před dev serverem projektu, který injektuje overlay do HTML odpovědí a jinak přeposílá vše beze změny (včetně HMR WebSocketů).
- Výběr elementu v prohlížeči, bublina s rychlými akcemi a vlastní instrukcí, podpora jednoho elementu i dávky.
- Instrukce i s kontextem se vloží do běžící session jako uživatelská zpráva a Claude začne pracovat sám.
- Živý průběh práce Claude zobrazený v overlay.
- Primárně Next.js a Vite + React.

## Ne-cíle (zatím)

- Schvalování oprávnění (permission prompts) z prohlížeče. Schvaluje se dál v terminálu, overlay na to jen upozorní. Lze přidat později přes Claude Code *channels*.
- Prohlížečové rozšíření (Chrome extension). Řešení je čistě proxy.
- Jiné frameworky než React (Vue, Svelte…) nad rámec obecného fallbacku (DOM cesta + text).
- Produkční/remote použití. Jen localhost.
- Přepisování absolutních adres (redirecty na `localhost:<port dev serveru>`, OAuth callbacky, `NEXTAUTH_URL` apod.). Rozhodnutí uživatele: v první verzi jen zdokumentovat jako známé omezení v README. Proxy jen přepíše `Host`/`Origin`, aby prošly kontroly dev serverů (Vite `allowedHosts`, Next `allowedDevOrigins`).
- Zveřejnění v marketplace. Teď jen pro uživatele, ale struktura má umožnit pozdější zveřejnění (čistý plugin, žádné natvrdo zadrátované cesty k uživatelově počítači).

## Anti-cíle (co by z toho udělalo selhání, i kdyby to „fungovalo“)

- Rozbití běžného chování stránky nebo HMR: když je výběrový režim vypnutý, stránka se musí chovat přesně jako bez proxy.
- Úpravy uživatelova projektu kvůli tomu, aby nástroj fungoval (instalace balíčků, změna configu). Projekt zůstává nedotčený.
- Nepřesný kontext: když agent nedostane dost informací, aby trefil správné místo, ztrácí to smysl. Raději víc kontextu než míň.
- Instrukce, které se ztratí nebo pošlou dvakrát.
- Kdokoli v síti může posílat příkazy do session: proxy poslouchá jen na `127.0.0.1` a endpointy pro instrukce jsou chráněné náhodným tokenem.

## Prostředí a omezení

- Uživatel má Claude Code **2.1.318**, macOS. Mody vyžadují 2.1.287+.
- Rozhodnutá architektura: **plugin s modem** (ne channels). Důvod: channels vyžadují spuštění `claude --dangerously-load-development-channels …`, což odporuje cíli „zapnout v jakékoli session“.
- Relevantní dokumentace (ověřeno 2026-11-04):
  - Mody: https://code.claude.com/docs/en/plugins/mods/overview.md, API: https://code.claude.com/docs/en/plugins/mods/api.md
  - Pluginy: https://code.claude.com/docs/en/plugins/create.md, https://code.claude.com/docs/en/plugins/manifest-reference.md
  - Hooky: https://code.claude.com/docs/en/hooks.md
  - Channels (pro budoucí schvalování z prohlížeče): https://code.claude.com/docs/en/channels-reference.md
- Ověřené vlastnosti modů: mod je plugin s JS hooky (`hooks/register.js`), umí přidat `/command`, kreslit panel/band, reagovat na tool cally, `$.prompt.submit({ text, asUser: true })` spustí turn, když je session nečinná, `$.http.fetch` pro HTTP požadavky, `$.clock.every` pro časovač. Hooks modul sám nemá Node API, ale přes `$.process.spawn` může spustit dlouho běžící proces (ověřeno v API docs). `$.prompt.submit` sám počká, až bude session nečinná. Po přerušení turnu (Esc) se čekající submit zahodí (`{ drop: … }`) a další volání se odmítají až do příštího vstupu uživatele. Při implementaci ověřit detaily přímo v API dokumentaci (a ve skillu `plugin-authoring`, který je k dispozici).

## Architektura

Jeden plugin `claude-inspect` se třemi částmi:

1. **Proxy server (Node, TypeScript)**: samostatný proces.
   - Přeposílá HTTP i WebSocket na `localhost:<port>` dev serveru (HMR Vite i Next.js musí fungovat).
   - Do HTML odpovědí (`text/html`) injektuje `<script>` overlaye. Musí zvládnout komprimované odpovědi a streamované HTML (Next.js), např. požadavkem bez `accept-encoding` k upstreamu a vložením skriptu před `</body>` nebo za `<head>`.
   - Vlastní endpointy pod rezervovaným prefixem (např. `/__claude_inspect/…`): servírování overlay bundlu, příjem instrukcí z overlay, fronta instrukcí pro mod, příjem událostí průběhu od modu, kanál průběhu do overlay (SSE nebo WebSocket).
   - Poslouchá jen na `127.0.0.1`. Token vygenerovaný při startu. Overlay ho dostane injektovaný se skriptem, mod ho zná ze startu.
2. **Mod** (`hooks/register.js`):
   - `/inspect <port>` spustí proxy, `/inspect stop` ho vypne, `/inspect` bez argumentu ukáže stav (adresa, port, počet čekajících instrukcí). Po startu vypíše do terminálu URL proxy.
   - Polluje frontu na proxy (~500 ms). Když čeká instrukce a session je nečinná, vyzvedne ji (atomicky, aby se nic neposlalo dvakrát) a vloží přes `$.prompt.submit({ asUser: true })`. Když Claude pracuje, instrukce čeká ve frontě a pošle se po skončení turnu.
   - Posílá na proxy události průběhu: začátek/konec tool callu (název nástroje + stručný cíl, např. soubor), čekání na schválení v terminálu, konec turnu (hotovo), chyba.
3. **Overlay** (prohlížečový bundle, vanilla TS, žádný framework kvůli izolaci): renderuje se do Shadow DOM, aby styly stránky a overlaye neovlivňovaly jedna druhou.

**Spuštění proxy:** mod ji spustí sám přes `$.process.spawn` (žádné MCP, žádný model v cestě, žádné flagy). Proxy patří k jedné session: builder ověří, že proces zanikne s koncem session. Pokud ne, ukončí ho v `session.end` hooku a jako pojistku proxy sama skončí, když se mod delší dobu neozve (heartbeat).

**Více sessions (moje rozhodnutí):** každá session, která spustí `/inspect`, má vlastní proxy na vlastním portu. Kliky v dané záložce jdou jen do session, která tu proxy spustila. Dvě sessions nad stejným dev serverem = dvě proxy, dvě adresy.

**Fronta a přerušení (moje rozhodnutí):**
- Instrukce se posílají po jedné, v pořadí, každá jako samostatný turn. Další odejde až po skončení předchozího turnu.
- Stav instrukce v overlay: ve frontě → odesláno → hotovo / přerušeno.
- Když uživatel turn přeruší (Esc), bere se to jako „zrušit“: instrukce se automaticky znovu **neposílá**. V overlay se označí jako přerušená s tlačítkem „Poslat znovu“. Zbytek fronty čeká, dokud uživatel něco nenapíše v terminálu nebo nedá „Poslat znovu“. Nic se tak neztratí potichu ani se nepošle dvakrát.

## UI v prohlížeči (schváleno: „varianta A — plovoucí bublina“)

Mockup: `2026-11-04-overlay-mockup.html` ve stejné složce (HTML fragment, odsouhlasený v brainstormingu).

- **Přepínač výběrového režimu**: zkratka **Alt+C** a malé tlačítko v levém dolním rohu („◎ Výběr zapnut · Alt+C“). Vypnuto = stránka se chová normálně. Zapnuto = klik nevyvolá akci stránky, ale vybere element. Esc ruší aktuální výběr nebo vypíná režim.
- **Hover**: čárkovaný oranžový obrys kolem elementu + štítek nad ním s tagem a zdrojem (`div.plan · PlanCard.tsx:8`, případně jen název komponenty).
- **Klik**: plný obrys a otevře se **bublina u elementu** (tmavá, kompaktní) s:
  - rychlými akcemi **✏️ Upravit · 🗑 Smazat · ✨ Vylepšit · ＋ Do dávky**
  - polem **Vlastní instrukce…**: Enter pošle hned.
  - „Smazat“ pošle hned. „Upravit“ a „Vylepšit“ předvyplní instrukci a nechají ji doplnit nebo odeslat Enterem (rozhodnutí buildera, pokud nepůsobí přirozeně).
- **Dávka**: elementy přidané „Do dávky“ (každý s volitelnou poznámkou) dostanou na stránce očíslované značky. Pilulka v rohu ukazuje „Dávka (N) · Odeslat“. Odeslání pošle všechny najednou v jedné zprávě. Prvek z dávky lze odebrat.
- **Pilulka průběhu (pravý dolní roh)**: sbalená ukazuje jednu řádku stavu („Claude: upravuje Pricing.tsx…“, „Hotovo“, „Čeká na schválení v terminálu“, „Ve frontě: 1“). Rozbalená ukazuje krátký log posledních kroků.
- Overlay přežije HMR i navigaci (při full reloadu se injektuje znovu, stav dávky se drží v `sessionStorage`).

## Kontext posílaný agentovi

Jedna uživatelská zpráva v terminálu, čitelná pro člověka i agenta. Pro každý element:

- instrukce (rychlá akce a/nebo vlastní text)
- URL stránky (bez proxy hostu, ideálně path)
- textový obsah elementu (zkrácený)
- tag, id, třídy, relevantní atributy
- **HTML cesta** od `body`/`main` (např. `main > section#pricing > div.plans > div.plan:nth-child(2) > span.badge`), přání uživatele
- unikátní CSS selektor
- React: název komponenty a řetězec rodičovských komponent; **soubor a řádek**, pokud jdou zjistit
- nadpis nejbližší sekce (nejbližší předchozí/nadřazený `h1`–`h3`, `section` s `aria-label` apod.)
- volitelně krátký výřez `outerHTML` (oříznutý)

Přesný formát zprávy je na builderovi. Musí být kompaktní, aby nezahlcovala terminál, a začínat jasnou instrukcí.

**Zjištění zdroje (soubor:řádek)** je nejrizikovější část. React 19 odstranil `_debugSource` a Next.js (App Router, Server Components) zdrojové informace na klientu často nemá. Builder má prozkoumat dostupné cesty bez zásahu do projektu (React DevTools-like čtení fiberu, `_debugStack`, `data-*` atributy, které už framework vkládá, source mapy přes proxy apod.). **Fallback je přijatelný:** název komponenty + text + DOM cesta + nadpis sekce. Agent si soubor dohledá sám.

## Rozhodnuto uživatelem

- Forma: rozšíření Claude Code, konkrétně **plugin s modem** (cesta přes mody, ne channels).
- Instrukce jdou do aktuálně otevřené session v terminálu. Výsledek se ukáže přes hot reload.
- Aktivace slash commandem `/inspect` v jakékoli session.
- Proxy před existujícím dev serverem, která přidává UI.
- UI: varianta A (bublina u elementu, průběh v rohu).
- Jeden element i dávka.
- Do kontextu patří i HTML cesta elementu.
- Frameworky: Next.js, Vite + React.
- Zatím jen pro uživatele, možná později zveřejnit.
- Umístění: `/Users/ondrejkonarik/Projects/claude-inspect`, název `claude-inspect`.
- Redirecty na absolutní URL dev serveru: v v1 jen známé omezení.

## Navrženo mnou (Claude), uživatel nijak nerozporoval

- Alt+C jako přepínač výběrového režimu na stránce.
- Fronta: když Claude pracuje, instrukce čeká a odejde po skončení turnu.
- Polling modu ~500 ms.
- Overlay v Shadow DOM, vanilla TS.
- Bezpečnost: jen `127.0.0.1` + token.
- Konkrétní seznam polí v kontextu (kromě HTML cesty, kterou chtěl uživatel).
- Proxy spouští mod přes `$.process.spawn`, jedna proxy na session.
- Instrukce po jedné, v pořadí; po Esc žádné automatické znovuposlání, v overlay „Poslat znovu“.

## Nechávám na builderovi

- Detaily životního cyklu proxy procesu (viz „Spuštění proxy“).
- Volba port proxy (default např. 4000, při obsazení další volný).
- Přesný formát zprávy pro agenta.
- Technika zjištění soubor:řádek a fallbacky.
- Jazyk/sestavení (TypeScript + esbuild doporučeno), struktura repa, testy.
- Detailní vzhled overlay v rámci mockupu (tmavá bublina, oranžový akcent).
