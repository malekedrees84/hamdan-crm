const Database = require('better-sqlite3');
const bcrypt   = require('bcryptjs');
const path     = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'leads.db');
const db = new Database(DB_PATH);

db.exec(`
  CREATE TABLE IF NOT EXISTS agents (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    name     TEXT NOT NULL,
    username TEXT NOT NULL UNIQUE,
    password TEXT NOT NULL,
    role     TEXT DEFAULT 'agent',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS leads (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    phone         TEXT NOT NULL UNIQUE,
    name          TEXT,
    location      TEXT,
    contact_phone TEXT,
    course        TEXT,
    status        TEXT DEFAULT 'waiting',
    assigned_to   INTEGER REFERENCES agents(id),
    created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS messages (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    phone     TEXT NOT NULL,
    direction TEXT NOT NULL,
    body      TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS notes (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    phone     TEXT NOT NULL,
    agent_id  INTEGER REFERENCES agents(id),
    text      TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Migrations
[
  ['location',      'TEXT'],
  ['contact_phone', 'TEXT'],
  ['assigned_to',   'INTEGER'],
].forEach(([col, type]) => {
  try { db.exec(`ALTER TABLE leads ADD COLUMN ${col} ${type}`); } catch {}
});

// seed agents
function seedAgents() {
  const agents = [
    { name: 'מנהל',   username: 'admin',  password: 'admin123',  role: 'admin' },
    { name: 'מיאדה',  username: 'mayada', password: 'mayada123', role: 'agent' },
    { name: 'אסיל',   username: 'aseel',  password: 'aseel123',  role: 'agent' },
    { name: 'מייסון', username: 'mayson', password: 'mayson123', role: 'agent' },
  ];
  const ins = db.prepare(`INSERT OR IGNORE INTO agents (name,username,password,role) VALUES (?,?,?,?)`);
  agents.forEach(a => ins.run(a.name, a.username, bcrypt.hashSync(a.password, 10), a.role));
}
seedAgents();

// ── Leads ────────────────────────────────────────────────
const saveLead    = db.prepare(`INSERT INTO leads (phone,status) VALUES (?,'waiting') ON CONFLICT(phone) DO UPDATE SET updated_at=CURRENT_TIMESTAMP`);
const updateLead  = db.prepare(`UPDATE leads SET name=COALESCE(?,name),location=COALESCE(?,location),contact_phone=COALESCE(?,contact_phone),course=COALESCE(?,course),status=COALESCE(?,status),updated_at=CURRENT_TIMESTAMP WHERE phone=?`);
const assignLead  = db.prepare(`UPDATE leads SET assigned_to=?,status=CASE WHEN status='waiting' THEN 'in_progress' ELSE status END,updated_at=CURRENT_TIMESTAMP WHERE phone=?`);
const getLead     = db.prepare(`SELECT * FROM leads WHERE phone=?`);
const deleteLead  = db.prepare(`DELETE FROM leads WHERE phone=?`);
const deleteMessages = db.prepare(`DELETE FROM messages WHERE phone=?`);
const deleteNotes = db.prepare(`DELETE FROM notes WHERE phone=?`);

const BASE = `SELECT l.*,a.name as agent_name FROM leads l LEFT JOIN agents a ON l.assigned_to=a.id`;
const getAllLeads      = db.prepare(`${BASE} ORDER BY l.created_at DESC`);
// נציגה רואה: לידים שלה + לידים בהמתנה (לא מוקצים)
const getLeadsForAgent = db.prepare(`${BASE} WHERE (l.assigned_to=? OR l.assigned_to IS NULL) ORDER BY l.assigned_to DESC, l.created_at DESC`);

const getStats        = db.prepare(`SELECT COUNT(*) as total, SUM(CASE WHEN status='in_progress' THEN 1 ELSE 0 END) as in_progress, SUM(CASE WHEN status='closed' THEN 1 ELSE 0 END) as closed, SUM(CASE WHEN status='future' THEN 1 ELSE 0 END) as future, SUM(CASE WHEN status='waiting' THEN 1 ELSE 0 END) as waiting FROM leads`);
const getStatsByAgent = db.prepare(`SELECT COUNT(*) as total, SUM(CASE WHEN status='in_progress' THEN 1 ELSE 0 END) as in_progress, SUM(CASE WHEN status='closed' THEN 1 ELSE 0 END) as closed, SUM(CASE WHEN status='future' THEN 1 ELSE 0 END) as future FROM leads WHERE assigned_to=?`);

// ── Messages ──────────────────────────────────────────────
const saveMessage     = db.prepare(`INSERT INTO messages (phone,direction,body) VALUES (?,?,?)`);
const getLeadMessages = db.prepare(`SELECT * FROM messages WHERE phone=? ORDER BY created_at ASC`);

// ── Notes ─────────────────────────────────────────────────
const addNote      = db.prepare(`INSERT INTO notes (phone,agent_id,text) VALUES (?,?,?)`);
const getNotes     = db.prepare(`SELECT n.*,a.name as agent_name FROM notes n LEFT JOIN agents a ON n.agent_id=a.id WHERE n.phone=? ORDER BY n.created_at DESC`);

// ── Agents ────────────────────────────────────────────────
const getAllAgents    = db.prepare(`SELECT id,name,username,role FROM agents ORDER BY role DESC,name`);
const getAgentByUser = db.prepare(`SELECT * FROM agents WHERE username=?`);

module.exports = {
  // leads
  saveLead:          (phone) => saveLead.run(phone),
  updateLead:        (phone, name, location, contactPhone, course, status) => updateLead.run(name, location, contactPhone, course, status, phone),
  assignLead:        (phone, agentId) => assignLead.run(agentId, phone),
  claimLead:         (phone, agentId) => {
    const lead = getLead.get(phone);
    if (!lead || lead.assigned_to) return false; // כבר תפוס
    assignLead.run(agentId, phone);
    return true;
  },
  getLead:           (phone) => getLead.get(phone),
  getAllLeads:        () => getAllLeads.all(),
  getLeadsForAgent:  (agentId) => getLeadsForAgent.all(agentId),
  getStats:          () => getStats.get(),
  getStatsByAgent:   (agentId) => getStatsByAgent.get(agentId),
  updateLeadStatus:  (phone, status) => db.prepare(`UPDATE leads SET status=?,updated_at=CURRENT_TIMESTAMP WHERE phone=?`).run(status, phone),
  deleteLead:        (phone) => { deleteLead.run(phone); deleteMessages.run(phone); deleteNotes.run(phone); },

  // messages
  saveMessage:       (phone, dir, body) => saveMessage.run(phone, dir, body),
  getLeadMessages:   (phone) => getLeadMessages.all(phone),

  // notes
  addNote:           (phone, agentId, text) => addNote.run(phone, agentId, text),
  getNotes:          (phone) => getNotes.all(phone),

  // agents
  getAllAgents:       () => getAllAgents.all(),
  getAgentByUsername:(username) => getAgentByUser.get(username),
  verifyPassword:    (plain, hash) => bcrypt.compareSync(plain, hash),
};
