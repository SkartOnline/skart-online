import { Server as HttpServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'skart-online-dev-secret-change-in-production';

interface AuthenticatedSocket extends WebSocket {
  userId?: number;
  username?: string;
  isAlive?: boolean;
}

export function setupWebSocket(server: HttpServer): WebSocketServer {
  const wss = new WebSocketServer({ server, path: '/ws' });

  // Heartbeat interval to detect disconnected clients
  const heartbeat = setInterval(() => {
    wss.clients.forEach((ws) => {
      const authWs = ws as AuthenticatedSocket;
      if (authWs.isAlive === false) {
        return authWs.terminate();
      }
      authWs.isAlive = false;
      authWs.ping();
    });
  }, 30000);

  wss.on('close', () => {
    clearInterval(heartbeat);
  });

  wss.on('connection', (ws: AuthenticatedSocket, req) => {
    ws.isAlive = true;

    ws.on('pong', () => {
      ws.isAlive = true;
    });

    // Extract token from query string
    const url = new URL(req.url || '', `http://${req.headers.host}`);
    const token = url.searchParams.get('token');

    if (token) {
      try {
        const decoded = jwt.verify(token, JWT_SECRET) as { id: number; username: string };
        ws.userId = decoded.id;
        ws.username = decoded.username;
      } catch {
        ws.send(JSON.stringify({ type: 'error', message: 'Invalid token' }));
        ws.close();
        return;
      }
    }

    // Send welcome message
    ws.send(JSON.stringify({
      type: 'connected',
      message: `Kapcsolódva / Connected${ws.username ? ` as ${ws.username}` : ''}`,
      userId: ws.userId
    }));

    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        console.log(`[WS] Message from ${ws.username || 'anonymous'}:`, message);

        // Stub: echo back with acknowledgment
        ws.send(JSON.stringify({
          type: 'ack',
          originalType: message.type,
          message: 'Üzenet fogadva / Message received'
        }));
      } catch {
        ws.send(JSON.stringify({ type: 'error', message: 'Invalid message format' }));
      }
    });

    ws.on('close', () => {
      console.log(`[WS] Client disconnected: ${ws.username || 'anonymous'}`);
    });
  });

  console.log('[WS] WebSocket server ready on /ws');
  return wss;
}
