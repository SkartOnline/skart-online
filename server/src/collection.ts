import { Router, Response } from 'express';
import { AuthRequest, authMiddleware } from './auth';
import db from './db';
import { ensureUserCardsCoverDeck, SavedDeck, validateDeckInput } from './deck_validation';

const router = Router();

// GET /api/collection — get user's collection
router.get('/', authMiddleware, (req: AuthRequest, res: Response): void => {
  try {
    const userId = req.user!.id;
    const collection = db.getCollection(userId);

    if (!collection) {
      // Create default empty collection
      db.saveCollection(userId, [], []);
      res.json({ cards: [], decks: [] });
      return;
    }

    res.json({
      cards: collection.card_data,
      decks: collection.deck_data
    });
  } catch (err) {
    console.error('Collection fetch error:', err);
    res.status(500).json({ error: 'Szerverhiba / Server error' });
  }
});

// PUT /api/collection — save user's collection
router.put('/', authMiddleware, (req: AuthRequest, res: Response): void => {
  try {
    const userId = req.user!.id;
    const { cards, decks } = req.body;

    db.saveCollection(userId, cards || [], decks || []);

    res.json({ success: true });
  } catch (err) {
    console.error('Collection save error:', err);
    res.status(500).json({ error: 'Szerverhiba / Server error' });
  }
});

// POST /api/collection/decks — create deck
router.post('/decks', authMiddleware, (req: AuthRequest, res: Response): void => {
  try {
    const userId = req.user!.id;
    const collection = db.getCollection(userId);
    if (!collection) {
      res.status(404).json({ error: 'Gyűjtemény nem található.' });
      return;
    }

    const name = String(req.body?.name || '').trim();
    if (name.length < 3) {
      res.status(400).json({ error: 'A pakli neve minimum 3 karakter legyen.' });
      return;
    }

    const validation = validateDeckInput(req.body?.characterIds, req.body?.mainCardIds, req.body?.sidedeckIds);
    if (!validation.valid) {
      res.status(400).json({ error: validation.errors[0] || 'Érvénytelen pakli.' });
      return;
    }

    const ownershipError = ensureUserCardsCoverDeck(collection.card_data || [], {
      characterIds: validation.normalizedCharacters,
      mainCardIds: validation.normalizedMainDeck
    });
    if (ownershipError) {
      res.status(400).json({ error: ownershipError });
      return;
    }

    const now = new Date().toISOString();
    const newDeck: SavedDeck = {
      id: `deck_${Date.now()}_${Math.random().toString(16).slice(2, 7)}`,
      name,
      characterIds: validation.normalizedCharacters,
      mainCardIds: validation.normalizedMainDeck,
      sidedeckIds: validation.normalizedSidedeck,
      created_at: now,
      updated_at: now
    };

    const existingDecks = (collection.deck_data || []) as SavedDeck[];
    const nextDecks = [...existingDecks, newDeck];
    db.saveCollection(userId, collection.card_data || [], nextDecks);

    res.status(201).json({ deck: newDeck, decks: nextDecks });
  } catch (err) {
    console.error('Deck create error:', err);
    res.status(500).json({ error: 'Szerverhiba / Server error' });
  }
});

// PUT /api/collection/decks/:deckId — update deck
router.put('/decks/:deckId', authMiddleware, (req: AuthRequest, res: Response): void => {
  try {
    const userId = req.user!.id;
    const collection = db.getCollection(userId);
    if (!collection) {
      res.status(404).json({ error: 'Gyűjtemény nem található.' });
      return;
    }

    const name = String(req.body?.name || '').trim();
    if (name.length < 3) {
      res.status(400).json({ error: 'A pakli neve minimum 3 karakter legyen.' });
      return;
    }

    const validation = validateDeckInput(req.body?.characterIds, req.body?.mainCardIds, req.body?.sidedeckIds);
    if (!validation.valid) {
      res.status(400).json({ error: validation.errors[0] || 'Érvénytelen pakli.' });
      return;
    }

    const ownershipError = ensureUserCardsCoverDeck(collection.card_data || [], {
      characterIds: validation.normalizedCharacters,
      mainCardIds: validation.normalizedMainDeck
    });
    if (ownershipError) {
      res.status(400).json({ error: ownershipError });
      return;
    }

    const decks = (collection.deck_data || []) as SavedDeck[];
    const idx = decks.findIndex(deck => deck.id === req.params.deckId);
    if (idx === -1) {
      res.status(404).json({ error: 'Pakli nem található.' });
      return;
    }

    const updated: SavedDeck = {
      ...decks[idx],
      name,
      characterIds: validation.normalizedCharacters,
      mainCardIds: validation.normalizedMainDeck,
      sidedeckIds: validation.normalizedSidedeck,
      updated_at: new Date().toISOString()
    };
    const nextDecks = [...decks];
    nextDecks[idx] = updated;
    db.saveCollection(userId, collection.card_data || [], nextDecks);

    res.json({ deck: updated, decks: nextDecks });
  } catch (err) {
    console.error('Deck update error:', err);
    res.status(500).json({ error: 'Szerverhiba / Server error' });
  }
});

// DELETE /api/collection/decks/:deckId — delete deck
router.delete('/decks/:deckId', authMiddleware, (req: AuthRequest, res: Response): void => {
  try {
    const userId = req.user!.id;
    const collection = db.getCollection(userId);
    if (!collection) {
      res.status(404).json({ error: 'Gyűjtemény nem található.' });
      return;
    }
    const decks = (collection.deck_data || []) as SavedDeck[];
    const nextDecks = decks.filter(deck => deck.id !== req.params.deckId);
    db.saveCollection(userId, collection.card_data || [], nextDecks);
    res.json({ success: true, decks: nextDecks });
  } catch (err) {
    console.error('Deck delete error:', err);
    res.status(500).json({ error: 'Szerverhiba / Server error' });
  }
});

export default router;
