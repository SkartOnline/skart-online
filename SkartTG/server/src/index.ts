import express from 'express';
import cors from 'cors';
import path from 'path';
import http from 'http';
import authRouter from './auth';
import collectionRouter from './collection';
import lobbiesRouter from './lobbies';
import cardEditorRouter from './card_editor';
import { CARD_CATALOG } from './cards';
import { setupWebSocket } from './websocket';

const app = express();
const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const WEB_BUILD_DIR = path.join(__dirname, '..', '..', 'web_build');
const PUBLIC_GODOT_DIR = path.join(PUBLIC_DIR, 'godot');

const setGodotFileHeaders = (res: express.Response, filePath: string) => {
  if (filePath.endsWith('.wasm')) {
    res.setHeader('Content-Type', 'application/wasm');
  } else if (filePath.endsWith('.pck')) {
    res.setHeader('Content-Type', 'application/octet-stream');
  }
};

// Middleware
app.use(cors());
app.use(express.json());

// API routes
app.use('/api/auth', authRouter);
app.use('/api/collection', collectionRouter);
app.use('/api/lobbies', lobbiesRouter);
app.use('/api/card-editor', cardEditorRouter);

// GET /api/cards — return all card definitions for the web client
app.get('/api/cards', (_req, res) => {
  res.json({ cards: CARD_CATALOG });
});

// Serve Godot web export from root web_build first (dev workflow), then fallback to public/godot.
// COOP/COEP headers are required for SharedArrayBuffer / Godot engine but scoped
// to /godot/ so that browser DevTools still works on the main page.
const godotIsolationMiddleware: express.RequestHandler = (_req, res, next) => {
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
  next();
};
app.use('/godot', godotIsolationMiddleware, express.static(WEB_BUILD_DIR, {
  setHeaders: setGodotFileHeaders,
}));
app.use('/godot', godotIsolationMiddleware, express.static(PUBLIC_GODOT_DIR, {
  setHeaders: setGodotFileHeaders,
}));

// Serve static files from public/
app.use(express.static(PUBLIC_DIR, {
  setHeaders: (res, filePath) => {
    setGodotFileHeaders(res, filePath);
  }
}));

// Card editor page (dev tool)
app.get('/card-editor', (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'card-editor.html'));
});

// SPA fallback — serve index.html for all non-API routes
app.get('*', (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

// Create HTTP server and attach WebSocket
const server = http.createServer(app);
setupWebSocket(server);

server.listen(PORT, () => {
  console.log(`\n  ==========================================`);
  console.log(`  Skart 2 Online szerver elindult / Server started`);
  console.log(`  http://localhost:${PORT}`);
  console.log(`  ==========================================\n`);
});
