# web-inspect

Mod pro Claude Code, lokální Node proxy a overlay v prohlížeči. Klikneš na element na své dev stránce, napíšeš instrukci a ta se pošle do tvé běžící session v Claude Code. Claude upraví kód, hot reload ukáže změnu a overlay zobrazuje, co Claude zrovna dělá.

## Instalace

```
claude --plugin-dir <cesta>/claude-inspect/plugin
```

Pro trvalé načítání přidej do `~/.claude/settings.json`:

```json
{ "env": { "CLAUDE_CODE_PLUGIN_DIRS": "<cesta>/claude-inspect/plugin" } }
```

`CLAUDE_CODE_PLUGIN_DIRS` načte adresáře pluginů stejně jako `--plugin-dir` (absolutní cesty oddělené `:`; jako proměnná prostředí nebo v `env` v `~/.claude/settings.json`), viz [Settings and environment variables](https://code.claude.com/docs/en/plugins/mods/reference.md#settings-and-environment-variables).

Požadavky: Claude Code ≥ 2.1.287 (mody; testováno na **2.1.318**), Node ≥ 20. Plugin je zbuildovaný, instalace nic nestahuje.

## Použití

1. Spusť dev server (např. `npm run dev` na portu 5173) a v Claude Code napiš `/inspect 5173`.
2. Otevři adresu proxy (výchozí `http://localhost:4000`, při obsazení další volný port). Proxy předává vše na dev server a přidá overlay.
3. **Alt+C** zapne a vypne výběr elementů, **Esc** výběr zruší. Najetím se zobrazí rámeček a štítek (značka · komponenta), kliknutím se otevře bublina.
4. Bublina: `✏️ Upravit`, `🗑 Smazat`, `✨ Vylepšit`, `＋ Do dávky` nebo vlastní instrukce (Enter pošle hned).
5. Dávka: `＋ Do dávky` označí element číslem. Pilulka `Dávka (N) · Odeslat` pošle všechny najednou jako jednu zprávu.
6. Pilulka vpravo dole ukazuje průběh (`Claude: upravuje …`, `Čeká na schválení v terminálu`, `Hotovo`, `Přerušeno`, u přerušené instrukce `Poslat znovu`).
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
