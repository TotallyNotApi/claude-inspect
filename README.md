# web-inspect

Mod pro Claude Code, lokální Node proxy a overlay v prohlížeči. Klikneš na element na své dev stránce, napíšeš instrukci a ta se pošle do tvé běžící session v Claude Code. Claude upraví kód, hot reload ukáže změnu a overlay zobrazuje, co Claude zrovna dělá.

## Instalace

Plugin se instaluje přes marketplace, takže je pak k dispozici v každé session Claude Code, v jakémkoli projektu.

**Z lokální složky** (stačí jednou):

```
claude plugin marketplace add <cesta>/claude-inspect
claude plugin install web-inspect@web-inspect --scope user
```

Totéž jde i uvnitř Claude Code: `/plugin marketplace add <cesta ke claude-inspect>` a pak `/plugin install web-inspect@web-inspect`. Běžící session načte plugin až po restartu.

**Z GitHubu:**

```
/plugin install web-inspect --marketplace TotallyNotApi/claude-inspect
```

nebo ve dvou krocích `claude plugin marketplace add TotallyNotApi/claude-inspect` a `claude plugin install web-inspect@web-inspect`.

**Ověření:** v libovolné session napiš `/inspect`. Má odpovědět `web-inspect: inactive. Use /inspect <dev server port>`.

**Aktualizace po změně kódu:** instalace je kopie v `~/.claude/plugins/cache`, změny v repu se samy nepropíšou. Po `npm run build` zvyš `version` v `plugin/.claude-plugin/plugin.json` a spusť:

```
claude plugin marketplace update web-inspect
claude plugin update web-inspect@web-inspect
```

Pak restartuj Claude Code.

**Odinstalace:**

```
claude plugin uninstall web-inspect@web-inspect
claude plugin marketplace remove web-inspect
```

**Bez instalace** (vývoj, jednorázové vyzkoušení): `claude --plugin-dir <cesta>/claude-inspect/plugin` načte plugin přímo z repa, bez kopírování. Při vývoji je lepší nainstalovanou verzi vypnout (`claude plugin disable web-inspect@web-inspect`), ať neběží dvě verze najednou.

Požadavky: Claude Code ≥ 2.1.287 (mody; testováno na **2.1.318**), Node ≥ 20. Plugin je zbuildovaný, instalace nic nestahuje.

## Použití

1. Spusť dev server (např. `npm run dev` na portu 5173) a v Claude Code napiš `/inspect 5173`.
2. Otevři adresu proxy (výchozí `http://localhost:4000`, při obsazení další volný port). Proxy předává vše na dev server a přidá overlay.
3. **⌘C** na macOS (jen když není označený text, jinak normálně kopíruje; funguje i ⌥C), **Alt+C** jinde: zapne a vypne výběr elementů. **Esc** výběr zruší. Najetím se zobrazí rámeček a štítek (značka · komponenta), kliknutím se otevře bublina.
4. Bublina (UI je v angličtině): nahoře název elementu, pod ním textové pole na instrukci (Enter pošle, Shift+Enter nový řádek) a ikonky s tooltipy: Edit, Delete (pošle hned), Improve, Add to batch a tlačítko Send.
5. Dávka: Add to batch označí element číslem. Pilulka `Batch (N) · Send` pošle všechny najednou jako jednu zprávu.
6. Pilulka vpravo dole ukazuje průběh (`Claude: editing …`, `Waiting for approval in the terminal`, `Done`, `Interrupted`, u přerušené instrukce `Send again`).
7. Když proxy přestane odpovídat (spadla, byla zabita), mod to do pár sekund pozná: stavový řádek ukáže `inspect: proxy spadla – /inspect <port>` a `/inspect` hlásí `proxy neběží`.
8. `/inspect stop` proxy ukončí. Když Claude Code skončí bez stopu, proxy zanikne sama cca 15 s po posledním heartbeatu (hned po startu má 30 s na první heartbeat).

**Bezpečnost:** proxy poslouchá jen na `127.0.0.1` a přijímá pouze požadavky s hlavičkou `Host` (a u `/__web-inspect/api/*` i `Origin`) `localhost`, `127.0.0.1` nebo `[::1]`; ostatní odmítne s 403 (ochrana proti DNS rebindingu). API navíc vyžaduje token, který zná jen vložený overlay a mod.

Zpráva pro Claude obsahuje text elementu, značku, sekci, komponenty, HTML cestu, selektor, HTML a (když jde zjistit) `soubor:řádek`.

## Příklady

`examples/vite-react` (port 5173) a `examples/next-app` (port 3000, `next dev`) mají stejnou sekci „Ceník“. V každém: `npm install && npm run dev`. Je-li port obsazený, spusť dev server na jiném (např. `npx next dev -p 3100`) a předej ho `/inspect`.

## Známá omezení

- Redirecty na absolutní URL dev serveru (OAuth, `NEXTAUTH_URL`) overlay obejdou.
- Po Esc je potřeba napsat zprávu v terminálu, než budou další instrukce z prohlížeče pokračovat.
- Next.js App Router (ověřeno na Next.js 15.5 + webpack dev): komponenty se berou i ze Server Components (React 19 `_debugInfo`), interní komponenty Next.js se odfiltrují a soubor:řádek se dohledá přes `/__nextjs_source-map` dev serveru (např. `PlanCard ← Pricing ← Page ← RootLayout (components/PlanCard.tsx:6)`). Když se mapa nenačte, použije se jen přibližný řádek zkompilovaného modulu. Turbopack (`next dev --turbopack`) a starší React (bez `_debugInfo`) ověřené nejsou. Vite + React: `src/PlanCard.tsx:6`.
- Schvalování oprávnění zůstává v terminálu.
- Proxy se sama ukončí cca 15 s po posledním heartbeatu modu (hned po startu čeká na první heartbeat 30 s). Ruční spuštění bez Claude Code proto potřebuje vlastní heartbeat.

## Vývoj

```
npm install
npm run build        # přegeneruje plugin/server/proxy.mjs a overlay.js (commitují se)
npx vitest run       # testy proxy a overlaye
cd plugin && claude plugin test   # testy modu
claude plugin validate ./plugin --strict
```
