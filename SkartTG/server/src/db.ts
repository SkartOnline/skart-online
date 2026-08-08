import fs from 'fs';
import path from 'path';
import { CARD_CATALOG } from './cards';

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'db.json');

export interface User {
  id: number;
  username: string;
  password_hash: string;
  created_at: string;
}

export interface Collection {
  user_id: number;
  card_data: any[];
  deck_data: any[];
}

interface DatabaseData {
  users: User[];
  collections: Collection[];
  next_id: number;
}

function getStarterCards(): any[] {
  return CARD_CATALOG.map(card => ({
    id: card.card_id,
    name: card.card_name,
    type: card.card_type,
    class: card.card_class,
    class2: card.card_class2 || '',
    cost: card.cost,
    attack: card.attack,
    hp: card.hp,
    // Keep legacy `health` field for web UI compatibility.
    // Source schema uses `hp` in CardDef.
    health: card.hp,
    range: card.spell_range,
    text: card.description,
    image: ''
  }));
}

function mergeMissingStarterCards(existingCards: any[]): { cards: any[]; changed: boolean } {
  const existing = Array.isArray(existingCards) ? existingCards : [];
  const presentIds = new Set<number>();
  for (const card of existing) {
    const id = Number(card?.id);
    if (Number.isFinite(id)) {
      presentIds.add(id);
    }
  }

  let changed = false;
  const next = [...existing];
  for (const starter of getStarterCards()) {
    const id = Number(starter.id);
    if (!presentIds.has(id)) {
      next.push(starter);
      presentIds.add(id);
      changed = true;
    }
  }

  return { cards: next, changed };
}

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Load or create database
function loadDb(): DatabaseData {
  if (fs.existsSync(DB_PATH)) {
    const raw = fs.readFileSync(DB_PATH, 'utf-8');
    return JSON.parse(raw);
  }
  return { users: [], collections: [], next_id: 1 };
}

function saveDb(data: DatabaseData): void {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf-8');
}

// Database operations
const db = {
  getUser(username: string): User | undefined {
    const data = loadDb();
    return data.users.find(u => u.username === username);
  },

  getUserById(id: number): User | undefined {
    const data = loadDb();
    return data.users.find(u => u.id === id);
  },

  createUser(username: string, passwordHash: string): User {
    const data = loadDb();
    const user: User = {
      id: data.next_id++,
      username,
      password_hash: passwordHash,
      created_at: new Date().toISOString()
    };
    data.users.push(user);
    data.collections.push({ user_id: user.id, card_data: getStarterCards(), deck_data: [] });
    saveDb(data);
    return user;
  },

  getCollection(userId: number): Collection | undefined {
    const data = loadDb();
    const collection = data.collections.find(c => c.user_id === userId);
    if (collection) {
      if (!collection.card_data || collection.card_data.length === 0) {
        collection.card_data = getStarterCards();
        saveDb(data);
      } else {
        const merged = mergeMissingStarterCards(collection.card_data);
        if (merged.changed) {
          collection.card_data = merged.cards;
          saveDb(data);
        }
      }
    }
    return collection;
  },

  saveCollection(userId: number, cards: any[], decks: any[]): void {
    const data = loadDb();
    const col = data.collections.find(c => c.user_id === userId);
    if (col) {
      col.card_data = cards;
      col.deck_data = decks;
    } else {
      data.collections.push({ user_id: userId, card_data: cards, deck_data: decks });
    }
    saveDb(data);
  }
};

export default db;
