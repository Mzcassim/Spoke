require('dotenv').config();
const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const { WebSocketServer } = require('ws');
const Database = require('better-sqlite3');

const app = express();
const server = http.createServer(app);

// --- Cookie helper ---
function parseCookies(req) {
  const obj = {};
  const str = req.headers.cookie || '';
  str.split(';').forEach(pair => {
    const [k, ...v] = pair.trim().split('=');
    if (k) obj[k] = v.join('=');
  });
  return obj;
}

// --- Config ---
const PORT = process.env.PORT || 3000;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'spoke-gala-2026';
const DATABASE_PATH = process.env.DATABASE_PATH || './data/gala.db';

// --- Ensure data directory exists ---
const dataDir = path.dirname(DATABASE_PATH);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// --- Database setup ---
const db = new Database(DATABASE_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS guests (
    wristband_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    role TEXT NOT NULL,
    registered_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS connections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    from_id TEXT NOT NULL REFERENCES guests(wristband_id),
    to_id TEXT NOT NULL REFERENCES guests(wristband_id),
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    payload TEXT NOT NULL,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// --- Prepared statements ---
const stmts = {
  getGuest: db.prepare('SELECT * FROM guests WHERE wristband_id = ?'),
  insertGuest: db.prepare('INSERT INTO guests (wristband_id, name, email, role) VALUES (?, ?, ?, ?)'),
  allGuests: db.prepare('SELECT * FROM guests ORDER BY registered_at DESC'),
  findConnection: db.prepare('SELECT * FROM connections WHERE (from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?)'),
  insertConnection: db.prepare('INSERT INTO connections (from_id, to_id) VALUES (?, ?)'),
  allConnections: db.prepare('SELECT * FROM connections ORDER BY timestamp DESC'),
  insertEvent: db.prepare('INSERT INTO events (type, payload) VALUES (?, ?)'),
  allEvents: db.prepare('SELECT * FROM events ORDER BY timestamp DESC'),
  guestCount: db.prepare('SELECT COUNT(*) as count FROM guests'),
  connectionCount: db.prepare('SELECT COUNT(*) as count FROM connections'),
  connectionsForGuest: db.prepare(`
    SELECT g.wristband_id, g.name, g.email, g.role, c.timestamp as connected_at
    FROM connections c
    JOIN guests g ON (g.wristband_id = CASE WHEN c.from_id = ? THEN c.to_id ELSE c.from_id END)
    WHERE c.from_id = ? OR c.to_id = ?
    ORDER BY c.timestamp ASC
  `),
  allConnectionsRich: db.prepare(`
    SELECT c.id, c.timestamp as connected_at,
      f.wristband_id as from_wristband, f.name as from_name, f.email as from_email, f.role as from_role,
      t.wristband_id as to_wristband, t.name as to_name, t.email as to_email, t.role as to_role
    FROM connections c
    JOIN guests f ON f.wristband_id = c.from_id
    JOIN guests t ON t.wristband_id = c.to_id
    ORDER BY c.timestamp ASC
  `),
  mostConnected: db.prepare(`
    SELECT g.wristband_id, g.name, COUNT(*) as conn_count
    FROM guests g
    JOIN connections c ON c.from_id = g.wristband_id OR c.to_id = g.wristband_id
    GROUP BY g.wristband_id
    ORDER BY conn_count DESC
    LIMIT 1
  `),
  firstConnection: db.prepare('SELECT MIN(timestamp) as ts FROM connections'),
  lastConnection: db.prepare('SELECT MAX(timestamp) as ts FROM connections'),
};

// --- WebSocket setup ---
const wss = new WebSocketServer({ server });
const wsClients = new Set();

wss.on('connection', (ws) => {
  wsClients.add(ws);
  ws.on('close', () => wsClients.delete(ws));
  ws.on('error', () => wsClients.delete(ws));
});

function broadcast(data) {
  const msg = JSON.stringify(data);
  for (const client of wsClients) {
    if (client.readyState === 1) {
      client.send(msg);
    }
  }
}

// --- Middleware ---
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- Helper: validate wristband ID ---
function isValidWristbandId(id) {
  return /^\d{3}$/.test(id) && parseInt(id, 10) >= 1 && parseInt(id, 10) <= 200;
}

// --- Helper: admin token check ---
function requireAdmin(req, res) {
  if (req.query.token !== ADMIN_TOKEN) {
    res.status(401).json({ error: 'Unauthorized' });
    return false;
  }
  return true;
}

// --- Routes: NFC tap landing page ---
app.get('/tap', (req, res) => {
  const wristbandId = req.query.id;
  if (!wristbandId) return res.status(400).send('Missing wristband ID');
  const cookies = parseCookies(req);
  const myId = cookies.my_wristband_id || '';
  const tapHtmlPath = path.join(__dirname, 'public', 'tap.html');
  let html = fs.readFileSync(tapHtmlPath, 'utf8');
  html = html.replace('__WRISTBAND_ID__', wristbandId).replace('__MY_ID__', myId);
  res.send(html);
});

app.get('/tap/:wristband_id', (req, res) => {
  const wristbandId = req.params.wristband_id;
  const cookies = parseCookies(req);
  const myId = cookies.my_wristband_id || '';
  const tapHtmlPath = path.join(__dirname, 'public', 'tap.html');
  let html = fs.readFileSync(tapHtmlPath, 'utf8');
  html = html.replace('__WRISTBAND_ID__', wristbandId).replace('__MY_ID__', myId);
  res.send(html);
});

// --- Routes: Registration page ---
app.get('/register/:wristband_id', (req, res) => {
  const wristbandId = req.params.wristband_id;
  const regHtmlPath = path.join(__dirname, 'public', 'register.html');
  let html = fs.readFileSync(regHtmlPath, 'utf8');
  html = html.replace('__WRISTBAND_ID__', wristbandId);
  res.send(html);
});

// --- Routes: Registered confirmation ---
app.get('/registered', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'registered.html'));
});

// --- Routes: Graph display ---
app.get('/graph', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'graph.html'));
});

// --- Routes: Check-in (admin) ---
app.get('/checkin', (req, res) => {
  if (req.query.token !== ADMIN_TOKEN) {
    return res.redirect('/');
  }
  res.sendFile(path.join(__dirname, 'public', 'checkin.html'));
});

// --- Routes: Admin ---
app.get('/admin', (req, res) => {
  if (req.query.token !== ADMIN_TOKEN) {
    return res.redirect('/');
  }
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// --- API: Register ---
app.post('/api/register', (req, res) => {
  const { wristband_id, name, email, role } = req.body;

  if (!wristband_id || !name || !email || !role) {
    return res.json({ success: false, error: 'All fields are required' });
  }

  if (!isValidWristbandId(wristband_id)) {
    return res.json({ success: false, error: 'Invalid wristband ID' });
  }

  const existing = stmts.getGuest.get(wristband_id);
  if (existing) {
    return res.json({ success: false, error: 'Already registered' });
  }

  stmts.insertGuest.run(wristband_id, name.trim(), email.trim(), role);
  stmts.insertEvent.run('registration', JSON.stringify({ wristband_id, name: name.trim(), role }));

  const guest = { wristband_id, name: name.trim(), role };
  broadcast({ type: 'new_guest', guest });

  res.setHeader('Set-Cookie', `my_wristband_id=${wristband_id};Path=/;Max-Age=31536000;SameSite=Lax`);
  res.json({ success: true, name: name.trim() });
});

// --- API: Connect ---
app.post('/api/connect', (req, res) => {
  const { from_id, to_id } = req.body;

  if (!from_id || !to_id) {
    return res.json({ success: false, error: 'Both IDs required' });
  }

  const fromGuest = stmts.getGuest.get(from_id);
  const toGuest = stmts.getGuest.get(to_id);

  if (!fromGuest || !toGuest) {
    return res.json({
      success: false,
      error: 'One or both guests not registered',
      from_name: fromGuest ? fromGuest.name : null,
      to_name: toGuest ? toGuest.name : null,
    });
  }

  // Check duplicate
  const existing = stmts.findConnection.get(from_id, to_id, to_id, from_id);
  if (existing) {
    return res.json({
      success: true,
      already_connected: true,
      from_name: fromGuest.name,
      to_name: toGuest.name,
    });
  }

  // Normalize: smaller ID as from_id
  const [normalFrom, normalTo] = from_id < to_id ? [from_id, to_id] : [to_id, from_id];

  stmts.insertConnection.run(normalFrom, normalTo);
  stmts.insertEvent.run('connection', JSON.stringify({ from_id: normalFrom, to_id: normalTo }));

  broadcast({
    type: 'new_connection',
    from: { wristband_id: fromGuest.wristband_id, name: fromGuest.name, role: fromGuest.role },
    to: { wristband_id: toGuest.wristband_id, name: toGuest.name, role: toGuest.role },
  });

  res.json({
    success: true,
    already_connected: false,
    from_name: fromGuest.name,
    to_name: toGuest.name,
  });
});

// --- API: Graph data ---
app.get('/api/graph', (req, res) => {
  const guests = stmts.allGuests.all();
  const connections = stmts.allConnections.all();
  const totalGuests = stmts.guestCount.get().count;
  const totalConnections = stmts.connectionCount.get().count;

  res.json({
    nodes: guests.map((g) => ({ wristband_id: g.wristband_id, name: g.name, role: g.role })),
    edges: connections.map((c) => ({ from_id: c.from_id, to_id: c.to_id, timestamp: c.timestamp })),
    stats: { total_guests: totalGuests, total_connections: totalConnections },
  });
});

// --- API: Export ---
app.get('/api/export', (req, res) => {
  if (!requireAdmin(req, res)) return;

  const guests = stmts.allGuests.all();
  const connections = stmts.allConnections.all();
  const events = stmts.allEvents.all();

  if (req.query.format === 'csv') {
    let csv = 'from_id,from_name,from_email,to_id,to_name,to_email,timestamp\n';
    for (const c of connections) {
      const fromG = stmts.getGuest.get(c.from_id);
      const toG = stmts.getGuest.get(c.to_id);
      csv += `${c.from_id},"${fromG.name}","${fromG.email}",${c.to_id},"${toG.name}","${toG.email}",${c.timestamp}\n`;
    }
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="gala_connections.csv"');
    return res.send(csv);
  }

  // Default: JSON
  const data = { guests, connections, events };
  if (req.query.format === 'json') {
    res.setHeader('Content-Disposition', 'attachment; filename="gala_export.json"');
  }
  res.json(data);
});

// --- API: Admin stats ---
app.get('/api/stats', (req, res) => {
  if (!requireAdmin(req, res)) return;

  const totalGuests = stmts.guestCount.get().count;
  const totalConnections = stmts.connectionCount.get().count;
  const most = stmts.mostConnected.get();
  const first = stmts.firstConnection.get();
  const last = stmts.lastConnection.get();

  res.json({
    total_guests: totalGuests,
    total_connections: totalConnections,
    most_connected: most ? { name: most.name, count: most.conn_count } : null,
    first_connection: first ? first.ts : null,
    last_connection: last ? last.ts : null,
  });
});

// --- API: Guest connections (for recap) ---
app.get('/api/guest/:wristband_id/connections', (req, res) => {
  if (!requireAdmin(req, res)) return;

  const guest = stmts.getGuest.get(req.params.wristband_id);
  if (!guest) return res.json({ success: false, error: 'Guest not found' });

  const conns = stmts.connectionsForGuest.all(req.params.wristband_id, req.params.wristband_id, req.params.wristband_id);
  res.json({ success: true, guest, connections: conns });
});

// --- API: Guest "wrapped" summary ---
app.get('/api/guest/:wristband_id/wrapped', (req, res) => {
  if (!requireAdmin(req, res)) return;

  const guest = stmts.getGuest.get(req.params.wristband_id);
  if (!guest) return res.json({ success: false, error: 'Guest not found' });

  const conns = stmts.connectionsForGuest.all(req.params.wristband_id, req.params.wristband_id, req.params.wristband_id);
  const totalGuests = stmts.guestCount.get().count;
  const totalConnections = stmts.connectionCount.get().count;
  const first = conns.length > 0 ? conns[0] : null;
  const last = conns.length > 0 ? conns[conns.length - 1] : null;

  const roleCounts = {};
  conns.forEach(c => { roleCounts[c.role] = (roleCounts[c.role] || 0) + 1; });

  res.json({
    success: true,
    guest: { name: guest.name, email: guest.email, role: guest.role, registered_at: guest.registered_at },
    stats: {
      connections_made: conns.length,
      total_guests_at_event: totalGuests,
      total_connections_at_event: totalConnections,
      first_connection: first ? { name: first.name, email: first.email, time: first.connected_at } : null,
      last_connection: last ? { name: last.name, email: last.email, time: last.connected_at } : null,
      connections_by_role: roleCounts,
    },
    people_met: conns.map(c => ({
      name: c.name,
      email: c.email,
      role: c.role,
      connected_at: c.connected_at,
    })),
  });
});

// --- API: All wrapped summaries (for bulk email) ---
app.get('/api/wrapped', (req, res) => {
  if (!requireAdmin(req, res)) return;

  const guests = stmts.allGuests.all();
  const totalGuests = stmts.guestCount.get().count;
  const totalConnections = stmts.connectionCount.get().count;

  const summaries = guests.map(guest => {
    const conns = stmts.connectionsForGuest.all(guest.wristband_id, guest.wristband_id, guest.wristband_id);
    return {
      name: guest.name,
      email: guest.email,
      role: guest.role,
      registered_at: guest.registered_at,
      connections_made: conns.length,
      people_met: conns.map(c => ({
        name: c.name,
        email: c.email,
        role: c.role,
        connected_at: c.connected_at,
      })),
    };
  });

  res.json({
    event_stats: { total_guests: totalGuests, total_connections: totalConnections },
    guests: summaries,
  });
});

// --- API: Reset database (admin) ---
app.post('/api/reset', (req, res) => {
  if (!requireAdmin(req, res)) return;
  db.exec('DELETE FROM connections; DELETE FROM events; DELETE FROM guests;');
  broadcast({ type: 'reset' });
  res.json({ success: true, message: 'Database reset' });
});

// --- API: All guests (for admin dropdown) ---
app.get('/api/guests', (req, res) => {
  if (!requireAdmin(req, res)) return;
  res.json(stmts.allGuests.all());
});

// --- API: Full DB backup (admin) ---
app.get('/api/backup', (req, res) => {
  if (!requireAdmin(req, res)) return;

  const guests = stmts.allGuests.all();
  const connections = stmts.allConnectionsRich.all();
  const events = stmts.allEvents.all();

  const backup = {
    exported_at: new Date().toISOString(),
    guests,
    connections,
    events,
  };

  res.setHeader('Content-Disposition', 'attachment; filename="spoke_backup.json"');
  res.json(backup);
});

// --- Periodic DB snapshot to console (every 5 min) ---
setInterval(() => {
  const guests = stmts.allGuests.all();
  const connections = stmts.allConnections.all();
  if (guests.length === 0 && connections.length === 0) return;

  const richConnections = stmts.allConnectionsRich.all();
  const snapshot = {
    timestamp: new Date().toISOString(),
    guests,
    connections: richConnections,
  };
  console.log('--- DB SNAPSHOT ---');
  console.log(JSON.stringify(snapshot));
  console.log('--- END SNAPSHOT ---');
}, 5 * 60 * 1000);

// --- Start server ---
server.listen(PORT, () => {
  console.log(`Spoke server running on port ${PORT}`);
  console.log(`Admin token: ${ADMIN_TOKEN}`);
  console.log(`Database: ${DATABASE_PATH}`);
});
