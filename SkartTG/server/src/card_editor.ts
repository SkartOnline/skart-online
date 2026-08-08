/**
 * card_editor.ts - Dev-only API routes for managing cards.json
 *
 * POST /api/card-editor/save    - Save full card array to cards.json
 * POST /api/card-editor/generate - Run the generator pipeline
 * GET  /api/card-editor/cards   - Read raw cards.json
 */

import { Router, Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

const router = Router();

const ROOT = path.resolve(__dirname, '..', '..');
const CARDS_JSON = path.join(ROOT, 'data', 'cards.json');

// GET raw cards.json
router.get('/cards', (_req: Request, res: Response) => {
  try {
    const raw = fs.readFileSync(CARDS_JSON, 'utf-8');
    const cards = JSON.parse(raw);
    res.json({ ok: true, cards });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST save full card array
router.post('/save', (req: Request, res: Response) => {
  try {
    const { cards } = req.body;
    if (!Array.isArray(cards)) {
      res.status(400).json({ ok: false, error: 'cards must be an array' });
      return;
    }
    // Sort by card_id
    cards.sort((a: any, b: any) => a.card_id - b.card_id);
    const json = JSON.stringify(cards, null, 2);
    fs.writeFileSync(CARDS_JSON, json, 'utf-8');
    res.json({ ok: true, count: cards.length });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST run generator
router.post('/generate', (_req: Request, res: Response) => {
  try {
    const cmd = `node -e "require('./server/node_modules/ts-node').register({project:'./tools/tsconfig.json'});require('./tools/generate_cards.ts')"`;
    const output = execSync(cmd, { cwd: ROOT, encoding: 'utf-8', timeout: 30000 });
    res.json({ ok: true, output });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message, output: err.stdout || '' });
  }
});

export default router;
