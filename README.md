# Skart

One project lives here now.

## `SkartCF/` — the current direction

Browser prototype for **Skart 2**: TypeScript, React, Vite, no game engine. A pure rules
engine with a hotseat game screen, an in-app card editor, and a headless balance
simulator on top of it.

**Play it: <https://skartonline.github.io/skart-online/>** — every push to `main` that
touches `SkartCF/` rebuilds and republishes it.

Start here: [`SkartCF/README.md`](SkartCF/README.md)

```
cd SkartCF && npm install && npm run dev
```

## `SkartTG` — archived in history

The earlier Godot 4 + Express/WebSocket build. It shares nothing with SkartCF and
was removed from the working tree; git history preserves it in full at the tag
`skarttg-archive`. To bring it back:

```
git checkout skarttg-archive -- SkartTG
```
