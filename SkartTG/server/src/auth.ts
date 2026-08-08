import { Router, Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import db from './db';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || 'skart-online-dev-secret-change-in-production';
const SALT_ROUNDS = 10;

// Extend Express Request to include user info
export interface AuthRequest extends Request {
  user?: { id: number; username: string };
}

// JWT middleware
export function authMiddleware(req: AuthRequest, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Nincs jogosultság / Unauthorized' });
    return;
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { id: number; username: string };
    req.user = decoded;
    next();
  } catch {
    res.status(401).json({ error: 'Érvénytelen token / Invalid token' });
  }
}

// POST /api/register
router.post('/register', async (req: Request, res: Response): Promise<void> => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      res.status(400).json({ error: 'Felhasználónév és jelszó szükséges / Username and password required' });
      return;
    }

    if (username.length < 3 || username.length > 20) {
      res.status(400).json({ error: 'A felhasználónév 3-20 karakter hosszú legyen / Username must be 3-20 characters' });
      return;
    }

    if (password.length < 4) {
      res.status(400).json({ error: 'A jelszó legalább 4 karakter legyen / Password must be at least 4 characters' });
      return;
    }

    // Check if user exists
    const existing = db.getUser(username);
    if (existing) {
      res.status(409).json({ error: 'A felhasználónév már foglalt / Username already taken' });
      return;
    }

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const newUser = db.createUser(username, passwordHash);
    const userId = newUser.id;

    const token = jwt.sign({ id: userId, username }, JWT_SECRET, { expiresIn: '7d' });

    res.status(201).json({
      token,
      user: { id: userId, username }
    });
  } catch (err) {
    console.error('Registration error:', err);
    res.status(500).json({ error: 'Szerverhiba / Server error' });
  }
});

// POST /api/login
router.post('/login', async (req: Request, res: Response): Promise<void> => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      res.status(400).json({ error: 'Felhasználónév és jelszó szükséges / Username and password required' });
      return;
    }

    const user = db.getUser(username);

    if (!user) {
      res.status(401).json({ error: 'Hibás felhasználónév vagy jelszó / Invalid username or password' });
      return;
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      res.status(401).json({ error: 'Hibás felhasználónév vagy jelszó / Invalid username or password' });
      return;
    }

    const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '7d' });

    res.json({
      token,
      user: { id: user.id, username: user.username }
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Szerverhiba / Server error' });
  }
});

export default router;
