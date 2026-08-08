# Skart 2 Online

Böngészőben játszható kártyajáték két játékos számára, 5×5-ös aréna harccal és egyedi laprendszerrel.  
A browser-based 1v1 card game with a 5×5 arena board and a custom card ability system.

> **Állapot / Status:** Aktív fejlesztés alatt — az egyéni játék és a kártya-szerkesztő működik, a többjátékos és a lobby rendszer fejlesztés alatt áll.

---

## Technológiák / Tech Stack

| Réteg | Technológia |
|---|---|
| Kliens (játék) | **Godot 4.6** — Web export (HTML5/WASM), GL Compatibility renderer |
| Kliens (menü) | Vanilla HTML/CSS/JS SPA, kiszolgálva az Express-szel |
| Backend | **Node.js + TypeScript**, Express, WebSocket (`ws`) |
| Hitelesítés | **JWT** (jsonwebtoken + bcryptjs) |
| Adatbázis (dev) | Flat JSON file (`server/data/db.json`) |
| Valós idejű | **WebSocket** — multiplayer game loop (fejlesztés alatt) |

---

## Játék / Gameplay

- 5×5 aréna rács
- Karakter, Egység és Varázslat típusú kártyák
- Nyolc kártyaosztály: Harcos, Mágus, Vaják, Zsivány, Bölcs, Garabonciás, Csodatevő, Mítikus
- Ötféle ritkaság: Közönséges → Mítikus
- Képesség alapú mechanika (Trigger-Target-Effect rendszer)

---

## Képesség-rendszer / Ability System

Az összes kártyaképesség a **Trigger-Target-Effect** hármasra épül:

- **Trigger** — mikor sül el a képesség (`ON_PLAY`, `ON_ATTACK`, `ACTIVATED`, `ON_DEATH`, stb.)
- **Target** — mit érinthet (egység, játékos, kéz, pakli, temető, terület, lap)
- **Effect** — mi történik (`Draw`, `Search`, `MoveToZone`, `ModifyStat`, `Summon`, stb.)

Megvalósítás:
- `scripts/abilities/trigger.gd`
- `scripts/abilities/target.gd`
- `scripts/abilities/effect_step.gd`
- `scripts/abilities/ability_queue.gd`
- `scripts/abilities/step_executor.gd`
- `scripts/abilities/condition_evaluator.gd`

---

## Kártyák egyetlen igazságforrása / Single Source of Truth

A `data/cards.json` az **összes kártya egyetlen forrása**.

Ne szerkeszd közvetlenül a generált fájlokat:
- `data/cards/*.tres`
- `scripts/cards/card_database.gd`
- `server/src/cards.ts`

### Kártya-szerkesztési folyamat

1. Szerkeszd a `data/cards.json` fájlt (vagy használd a beépített kártya-szerkesztőt: `/card-editor.html`).
2. Ellenőrizd a sémát és a konzisztenciát.
3. Generáld a Godot `.tres` erőforrásokat és a szerver kártyakatalógust.
4. Indítsd újra a szervert (és szükség esetén töröld és hozd létre újra a `server/data/db.json` fájlt a starter kártyák frissítéséhez).

```bash
cd server
npm run validate-cards
npm run generate-cards
```

`npm run generate-cards` a következőket frissíti:
- `data/cards/*.tres`
- `scripts/cards/card_database.gd`
- `server/src/cards.ts`

---

## Projekt felépítés / Project Structure

```
project-skart-online/
├── data/
│   ├── cards.json           # Összes kártya forrása / Master card definitions
│   └── cards/               # Generált Godot .tres erőforrások (ne szerkeszd)
├── scenes/                  # Godot jelenetek
│   ├── main.tscn
│   └── arena/               # 5×5 aréna jelenet és kártya vizuál
├── scripts/
│   ├── main.gd
│   ├── js_bridge.gd         # JavaScript ↔ Godot híd (autoload)
│   ├── abilities/           # Képességrendszer (trigger, target, effect, queue)
│   ├── arena/               # Aréna logika, grid_cell, unit_instance
│   ├── cards/               # Kártya alaposztályok (Card, UnitCard, SpellCard, stb.)
│   └── game/                # Játékállapot (GameManager, GameState, PlayerState, stb.)
├── server/
│   ├── src/
│   │   ├── index.ts         # Express + HTTP szerver belépési pont
│   │   ├── auth.ts          # JWT regisztráció/bejelentkezés
│   │   ├── collection.ts    # Gyűjtemény és pakli API
│   │   ├── lobbies.ts       # Lobby kezelés
│   │   ├── multiplayer.ts   # WebSocket játéklogika (fejlesztés alatt)
│   │   ├── websocket.ts     # WS szerver wrapper
│   │   ├── db.ts            # Flat JSON adatbázis réteg
│   │   ├── cards.ts         # Generált kártyakatalógus (ne szerkeszd)
│   │   ├── card_editor.ts   # Fejlesztői kártya-szerkesztő API
│   │   └── deck_validation.ts
│   ├── public/              # Statikus SPA frontend (HTML menü)
│   │   └── godot/           # Godot web export kimenete (generált, gitignore-ban)
│   └── data/                # Runtime adatok — gitignore-ban van
│       └── db.json          # Felhasználók, gyűjtemények (ne commitold)
├── tools/
│   ├── generate_cards.ts    # Kártyagenerátor eszköz
│   └── validate_cards.ts    # Kártyavalidátor eszköz
├── assets/
├── Rulebook.txt             # Játékszabályok
└── project.godot
```

---

## Indítás / Getting Started

### Előfeltételek / Prerequisites

- [Godot 4.6](https://godotengine.org/) (Web export template-hez szükséges a web export)
- [Node.js 20+](https://nodejs.org/)

### Szerver indítása / Start the Server

```bash
cd server
npm install
npm run dev
```

A szerver elindul: `http://localhost:3000`  
The server starts at `http://localhost:3000`

Windows PowerShell esetén, ha npm.ps1 blokkolva van:
```powershell
npm.cmd run dev
```

Vagy használd a mellékelt `server/start-dev.bat` fájlt.

### Godot project megnyitása

Nyisd meg a Godot Engine-ben, és kövesd az exportálási lépéseket a webre való közzétételhez.  
Web export cél: `server/public/godot/index.html`

---

## API Végpontok / API Endpoints

| Végpont | Módszer | Leírás |
|---|---|---|
| `/api/auth/register` | POST | Regisztráció |
| `/api/auth/login` | POST | Bejelentkezés |
| `/api/collection` | GET | Gyűjtemény lekérése |
| `/api/collection` | PUT | Gyűjtemény / pakli mentése |
| `/api/cards` | GET | Kártyakatalógus |
| `/api/lobbies` | GET/POST | Lobby lista és létrehozás |
| `/api/card-editor/*` | GET/POST | Fejlesztői kártya-szerkesztő |
| `/ws` | WebSocket | Valós idejű játék kommunikáció |

---

## Deployment

A Godot web build statikus fájlok — GitHub Pages-re is hostolható.  
A Node.js backend-nek külön hostra van szüksége (pl. Fly.io, Render, Railway).  
A `server/data/db.json` dev-only — éles környezetben cseréld le valódi adatbázisra (pl. Supabase/Postgres, MongoDB Atlas).

A `JWT_SECRET` környezeti változót mindig állítsd be éles szerveren:
```bash
export JWT_SECRET=your-strong-random-secret
```
