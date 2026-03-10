import { Router, Response } from 'express';
import { AuthRequest, authMiddleware } from './auth';
import db from './db';
import { SavedDeck } from './deck_validation';
import { multiplayerService } from './multiplayer';

const router = Router();

function getLobbyId(raw: string | string[] | undefined): string {
  if (Array.isArray(raw)) {
    return raw[0] || '';
  }
  return raw || '';
}

function getUserDecks(userId: number): SavedDeck[] {
  const collection = db.getCollection(userId);
  return (collection?.deck_data || []) as SavedDeck[];
}

router.get('/', authMiddleware, (_req: AuthRequest, res: Response): void => {
  res.json({ lobbies: multiplayerService.listLobbies() });
});

router.post('/', authMiddleware, (req: AuthRequest, res: Response): void => {
  try {
    const user = req.user!;
    const name = String(req.body?.name || '').trim();
    const password = String(req.body?.password || '').trim();
    const devMode = !!req.body?.devMode;

    if (name.length < 3) {
      res.status(400).json({ error: 'A lobby neve minimum 3 karakter legyen.' });
      return;
    }

    const lobby = multiplayerService.createLobby(name, user.id, user.username, password || undefined, devMode);
    res.status(201).json({ lobby });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Hiba a lobby létrehozásakor.' });
  }
});

router.get('/:lobbyId', authMiddleware, (req: AuthRequest, res: Response): void => {
  const lobby = multiplayerService.getLobby(getLobbyId(req.params.lobbyId));
  if (!lobby) {
    res.status(404).json({ error: 'A lobby nem található.' });
    return;
  }
  res.json({ lobby });
});

router.post('/:lobbyId/join', authMiddleware, (req: AuthRequest, res: Response): void => {
  try {
    const user = req.user!;
    const password = String(req.body?.password || '').trim();
    const lobby = multiplayerService.joinLobby(getLobbyId(req.params.lobbyId), user.id, user.username, password || undefined);
    res.json({ lobby });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Csatlakozási hiba.' });
  }
});

router.post('/:lobbyId/leave', authMiddleware, (req: AuthRequest, res: Response): void => {
  multiplayerService.leaveLobby(getLobbyId(req.params.lobbyId), req.user!.id);
  res.json({ success: true });
});

router.post('/:lobbyId/deck', authMiddleware, (req: AuthRequest, res: Response): void => {
  try {
    const deckId = String(req.body?.deckId || '').trim();
    const userId = req.user!.id;
    const decks = getUserDecks(userId);
    const exists = decks.some(deck => deck.id === deckId);
    if (!exists) {
      res.status(400).json({ error: 'A kiválasztott pakli nem található.' });
      return;
    }

    const lobby = multiplayerService.selectDeck(getLobbyId(req.params.lobbyId), userId, deckId);
    res.json({ lobby });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Pakliválasztási hiba.' });
  }
});

router.post('/:lobbyId/ready', authMiddleware, (req: AuthRequest, res: Response): void => {
  try {
    const ready = !!req.body?.ready;
    const lobby = multiplayerService.setReady(getLobbyId(req.params.lobbyId), req.user!.id, ready);

    const userDecks = new Map<number, SavedDeck[]>();
    lobby.players.forEach(player => {
      userDecks.set(player.userId, getUserDecks(player.userId));
    });
    const game = multiplayerService.maybeStartGame(getLobbyId(req.params.lobbyId), userDecks);

    res.json({ lobby, gameStarted: !!game, gameId: game?.id });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Ready állapot hiba.' });
  }
});

router.get('/:lobbyId/game', authMiddleware, (req: AuthRequest, res: Response): void => {
  const internal = multiplayerService.getLobbyInternal(getLobbyId(req.params.lobbyId));
  if (!internal || !internal.gameId) {
    res.status(404).json({ error: 'A játék még nem indult el.' });
    return;
  }
  const game = multiplayerService.getGame(internal.gameId);
  if (!game) {
    res.status(404).json({ error: 'A játék nem található.' });
    return;
  }
  console.log(`[Game] GET game for lobby=${internal.id}, gameId=${internal.gameId}, setupData.players=${game.setupData?.players?.length ?? 'MISSING'}`);
  res.json({ game });
});

router.post('/:lobbyId/game/state', authMiddleware, (req: AuthRequest, res: Response): void => {
  try {
    const internal = multiplayerService.getLobbyInternal(getLobbyId(req.params.lobbyId));
    if (!internal || !internal.gameId) {
      res.status(404).json({ error: 'A játék még nem indult el.' });
      return;
    }

    const newState = req.body?.gameState;
    if (!newState || typeof newState !== 'object') {
      res.status(400).json({ error: 'Hiányzó vagy érvénytelen gameState.' });
      return;
    }

    const game = multiplayerService.updateGameState(internal.gameId, req.user!.id, newState);
    res.json({ game });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Állapot frissítési hiba.' });
  }
});

export default router;
