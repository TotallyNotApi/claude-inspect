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

Požadavky: Claude Code ≥ 2.1.287 (mody; testováno na **2.1.318**), Node ≥ 20. Plugin je zbuildovaný, instalace nic nestahuje.

## Použití

1. Spusť dev server (např. `npm run dev` na portu 5173) a v Claude Code napiš `/inspect 5173`.
2. Otevři adresu proxy (výchozí `http://localhost:4000`, při obsazení další volný port). Proxy předává vše na dev server a přidá overlay.
3. **Alt+C** zapne a vypne výběr elementů, **Esc** výběr zruší. Najetím se zobrazí rámeček a štítek (značka · komponenta), kliknutím se otevře bublina.
4. Bublina: `✏️ Upravit`, `🗑 Smazat`, `✨ Vylepšit`, `＋ Do dávky` nebo vlastní instrukce (Enter pošle hned).
5. Dávka: `＋ Do dávky` označí element číslem. Pilulka `Dávka (N) · Odeslat` pošle všechny najednou jako jednu zprávu.
6. Pilulka vpravo dole ukazuje průběh (`Claude: upravuje …`, `Čeká na schválení v terminálu`, `Hotovo`, `Přerušeno`, u přerušené instrukce `Poslat znovu`).
7. `/inspect stop` proxy ukončí. Když Claude Code skončí bez stopu, proxy zanikne sama do cca 15 s.

Zpráva pro Claude obsahuje text elementu, značku, sekci, komponenty, HTML cestu, selektor, HTML a (když jde zjistit) `soubor:řádek`.

## Příklady

`examples/vite-react` (port 5173) a `examples/next-app` (port 3000, `next dev`) mají stejnou sekci „Ceník“. V každém: `npm install && npm run dev`.

## Známá omezení

- Redirecty na absolutní URL dev serveru (OAuth, `NEXTAUTH_URL`) overlay obejdou.
- Po Esc je potřeba napsat zprávu v terminálu, než budou další instrukce z prohlížeče pokračovat.
- Soubor:řádek nemusí být dostupný u Server Components v Next.js. V ověření na Next.js 15 (App Router) se zdroj nezjistil vůbec a seznam komponent obsahoval interní komponenty Next.js, takže zpráva spoléhá na text, HTML cestu a selektor. U Vite + React se zdroj zjistí (`src/PlanCard.tsx:6`).
- Schvalování oprávnění zůstává v terminálu.
- Proxy se sama ukončí, když mod přestane posílat heartbeat (bez heartbeatu za cca 30 s). Je-li dev server na portu 3000 už obsazený, použij jiný port.

## Vývoj

```
npm install
npm run build        # přegeneruje plugin/server/proxy.mjs a overlay.js (commitují se)
npx vitest run       # testy proxy a overlaye
cd plugin && claude plugin test   # testy modu
claude plugin validate ./plugin --strict
```
