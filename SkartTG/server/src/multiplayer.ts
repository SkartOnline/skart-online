import { SavedDeck } from './deck_validation';

// ========================================================================
// INTERFACES — lobby management + raw game state storage
// ========================================================================

interface LobbyPlayer {
  userId: number;
  username: string;
  deckId?: string;
  ready: boolean;
}

export interface Lobby {
  id: string;
  name: string;
  password?: string;
  hostUserId: number;
  players: LobbyPlayer[];
  status: 'waiting' | 'started';
  gameId?: string;
  devMode: boolean;
  createdAt: string;
}

/**
 * The server does NOT understand or process game logic.
 * It stores exactly what the Godot client sends as the current game state.
 * Both clients run game_manager.gd which IS the game engine.
 */
export interface StoredGameState {
  [key: string]: unknown;
}

export interface MultiplayerGame {
  id: string;
  lobbyId: string;
  /** Initial setup data — player user IDs, deck card IDs, character IDs */
  setupData: {
    players: Array<{
      userId: number;
      username: string;
      characterIds: number[];
      deckCardIds: number[];
      sidedeckIds: number[];
    }>;
    firstPlayerUserId: number;
    secondPlayerUserId: number;
    devMode: boolean;
  };
  /** The live game state — opaque JSON blob managed entirely by Godot clients */
  gameState: StoredGameState;
  createdAt: string;
}

// ========================================================================
// HELPERS
// ========================================================================

function shuffle(array: number[]): number[] {
  const copy = [...array];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

// ========================================================================
// MULTIPLAYER SERVICE — lobby CRUD + dumb state relay
// ========================================================================

class MultiplayerService {
  private lobbies = new Map<string, Lobby>();
  private games = new Map<string, MultiplayerGame>();

  // ============================
  // LOBBY MANAGEMENT
  // ============================

  listLobbies(): Lobby[] {
    return [...this.lobbies.values()]
      .filter(l => l.status === 'waiting')
      .map(lobby => ({ ...lobby, password: lobby.password ? '***' : undefined }));
  }

  getLobby(lobbyId: string): Lobby | undefined {
    const lobby = this.lobbies.get(lobbyId);
    if (!lobby) return undefined;
    return { ...lobby, password: lobby.password ? '***' : undefined };
  }

  getLobbyInternal(lobbyId: string): Lobby | undefined {
    return this.lobbies.get(lobbyId);
  }

  createLobby(name: string, hostUserId: number, hostUsername: string, password?: string, devMode?: boolean): Lobby {
    const id = `lob_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
    const lobby: Lobby = {
      id, name,
      password: password || undefined,
      hostUserId,
      players: [{ userId: hostUserId, username: hostUsername, ready: false }],
      status: 'waiting',
      devMode: !!devMode,
      createdAt: new Date().toISOString()
    };
    this.lobbies.set(id, lobby);
    return { ...lobby, password: lobby.password ? '***' : undefined };
  }

  joinLobby(lobbyId: string, userId: number, username: string, password?: string): Lobby {
    const lobby = this.lobbies.get(lobbyId);
    if (!lobby) throw new Error('A lobby nem található.');
    if (lobby.status !== 'waiting') throw new Error('Ez a lobby már elindult.');
    if (lobby.players.length >= 2 && !lobby.players.some(p => p.userId === userId))
      throw new Error('A lobby megtelt.');
    if (lobby.password && lobby.password !== (password || ''))
      throw new Error('Hibás jelszó.');
    if (!lobby.players.find(p => p.userId === userId))
      lobby.players.push({ userId, username, ready: false });
    return { ...lobby, password: lobby.password ? '***' : undefined };
  }

  leaveLobby(lobbyId: string, userId: number): void {
    const lobby = this.lobbies.get(lobbyId);
    if (!lobby) return;
    lobby.players = lobby.players.filter(p => p.userId !== userId);
    if (lobby.players.length === 0) { this.lobbies.delete(lobbyId); return; }
    if (lobby.hostUserId === userId) lobby.hostUserId = lobby.players[0].userId;
  }

  selectDeck(lobbyId: string, userId: number, deckId: string): Lobby {
    const lobby = this.lobbies.get(lobbyId);
    if (!lobby) throw new Error('A lobby nem található.');
    const player = lobby.players.find(p => p.userId === userId);
    if (!player) throw new Error('Nem vagy a lobby tagja.');
    player.deckId = deckId;
    player.ready = false;
    return { ...lobby, password: lobby.password ? '***' : undefined };
  }

  setReady(lobbyId: string, userId: number, ready: boolean): Lobby {
    const lobby = this.lobbies.get(lobbyId);
    if (!lobby) throw new Error('A lobby nem található.');
    const player = lobby.players.find(p => p.userId === userId);
    if (!player) throw new Error('Nem vagy a lobby tagja.');
    if (!player.deckId) throw new Error('Válassz paklit, mielőtt késznek jelölöd magad.');
    player.ready = ready;
    return { ...lobby, password: lobby.password ? '***' : undefined };
  }

  // ============================
  // GAME INITIALIZATION — minimal, just stores decks+characters
  // ============================

  maybeStartGame(lobbyId: string, userDecksByUserId: Map<number, SavedDeck[]>): MultiplayerGame | null {
    const lobby = this.lobbies.get(lobbyId);
    if (!lobby) throw new Error('A lobby nem található.');
    if (lobby.players.length !== 2) return null;
    if (!lobby.players.every(p => p.ready && !!p.deckId)) return null;
    if (lobby.status === 'started' && lobby.gameId) {
      return this.games.get(lobby.gameId) || null;
    }

    // Build setup data — server stores deck composition, does NOT run game logic
    const setupPlayers = lobby.players.map(p => {
      const decks = userDecksByUserId.get(p.userId) || [];
      const deck = decks.find(d => d.id === p.deckId);
      if (!deck) throw new Error(`A kiválasztott pakli nem található: ${p.username}`);
      return {
        userId: p.userId,
        username: p.username,
        characterIds: [...deck.characterIds],
        deckCardIds: shuffle(deck.mainCardIds),
        sidedeckIds: [...(deck.sidedeckIds || [])],
      };
    });

    const gameId = `game_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
    const game: MultiplayerGame = {
      id: gameId,
      lobbyId,
      setupData: {
        players: setupPlayers,
        firstPlayerUserId: lobby.players[0].userId,
        secondPlayerUserId: lobby.players[1].userId,
        devMode: lobby.devMode,
      },
      gameState: {},
      createdAt: new Date().toISOString(),
    };

    lobby.status = 'started';
    lobby.gameId = gameId;
    this.games.set(gameId, game);
    console.log(`[Game] Created game ${gameId} for lobby ${lobbyId}: P1=${setupPlayers[0]?.username}(${setupPlayers[0]?.userId}) chars=[${setupPlayers[0]?.characterIds}] deck=${setupPlayers[0]?.deckCardIds?.length} cards, P2=${setupPlayers[1]?.username}(${setupPlayers[1]?.userId}) chars=[${setupPlayers[1]?.characterIds}] deck=${setupPlayers[1]?.deckCardIds?.length} cards`);
    return game;
  }

  getGame(gameId: string): MultiplayerGame | undefined {
    return this.games.get(gameId);
  }

  // ============================
  // STATE RELAY — store whatever the client sends, no processing
  // ============================

  updateGameState(gameId: string, userId: number, newState: StoredGameState): MultiplayerGame {
    const game = this.games.get(gameId);
    if (!game) throw new Error('A játék nem található.');
    const isPlayer = game.setupData.players.some(p => p.userId === userId);
    if (!isPlayer) throw new Error('Nem vagy részese ennek a meccsnek.');
    game.gameState = newState;
    return game;
  }
}

export const multiplayerService = new MultiplayerService();
