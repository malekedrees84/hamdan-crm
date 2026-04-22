const express  = require('express');
const cors     = require('cors');
const path     = require('path');
const fs       = require('fs');
const qrcode   = require('qrcode');
const multer   = require('multer');
const session  = require('express-session');
const db       = require('./db');
const { initAllBots, connectBot, disconnectBot, getBotStatus, getAllBotsStatus, sendMessage } = require('./botManager');
const { getCourseFileInfo } = require('./courseFiles');
const { COURSES } = require('./conversation');

const app  = express();
const PORT = process.env.PORT || 3000;
const COURSE_DIR = path.join(__dirname, 'course_files');

// ── Sessions ──────────────────────────────────────────
app.use(session({
  secret: 'hamdan-secret-2024',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 8 * 60 * 60 * 1000 },
}));

app.use(cors());
app.use(express.json());

// ── Auth middleware ───────────────────────────────────
function requireAuth(req, res, next) {
  if (req.session && req.session.agent) return next();
  res.status(401).json({ error: 'unauthorized' });
}
function requireAdmin(req, res, next) {
  if (req.session?.agent?.role === 'admin') return next();
  res.status(403).json({ error: 'admin only' });
}

// ── Static ────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

// ── Auth routes ───────────────────────────────────────
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const agent = db.getAgentByUsername(username);
  if (!agent || !db.verifyPassword(password, agent.password))
    return res.status(401).json({ error: 'שם משתמש או סיסמה שגויים' });
  req.session.agent = { id: agent.id, name: agent.name, username: agent.username, role: agent.role };
  res.json({ id: agent.id, name: agent.name, role: agent.role });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

app.get('/api/me', (req, res) => {
  if (!req.session?.agent) return res.status(401).json({ error: 'unauthorized' });
  res.json(req.session.agent);
});

// ── Bots (multi-WhatsApp) ─────────────────────────────
app.get('/api/bots', requireAuth, async (req, res) => {
  const all = getAllBotsStatus();
  const result = await Promise.all(all.map(async b => ({
    ...b,
    qrImage: b.qr ? await qrcode.toDataURL(b.qr) : null,
    qr: undefined,
  })));
  res.json(result);
});

app.post('/api/bots/:id/connect', requireAuth, requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id);
  await connectBot(id);
  res.json({ success: true });
});

app.post('/api/bots/:id/disconnect', requireAuth, requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id);
  await disconnectBot(id);
  res.json({ success: true });
});

// ── Legacy status (backward compat) ───────────────────
app.get('/api/status', requireAuth, async (req, res) => {
  const b = getBotStatus(1);
  const qrImage = b.qr ? await qrcode.toDataURL(b.qr) : null;
  res.json({ status: b.status, qrImage, number: b.number });
});

// ── Leads ─────────────────────────────────────────────
app.get('/api/leads', requireAuth, (req, res) => {
  const agent = req.session.agent;
  const leads = agent.role === 'admin' ? db.getAllLeads() : db.getLeadsForAgent(agent.id);
  res.json(leads);
});

app.get('/api/stats', requireAuth, (req, res) => {
  const agent = req.session.agent;
  const stats = agent.role === 'admin' ? db.getStats() : db.getStatsByAgent(agent.id);
  res.json(stats);
});

app.get('/api/leads/:phone/messages', requireAuth, (req, res) =>
  res.json(db.getLeadMessages(req.params.phone))
);

app.post('/api/leads/:phone/send', requireAuth, async (req, res) => {
  const { message } = req.body;
  if (!message) return res.status(400).json({ error: 'message required' });
  try {
    await sendMessage(req.params.phone, message);
    db.saveMessage(req.params.phone, 'out', message);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/leads/:phone', requireAuth, (req, res) => {
  const { status } = req.body;
  db.updateLeadStatus(req.params.phone, status);
  res.json({ success: true });
});

app.delete('/api/leads/:phone', requireAuth, requireAdmin, (req, res) => {
  db.deleteLead(req.params.phone);
  res.json({ success: true });
});

app.post('/api/leads/:phone/claim', requireAuth, (req, res) => {
  const claimed = db.claimLead(req.params.phone, req.session.agent.id);
  res.json({ success: true, claimed });
});

app.post('/api/leads/:phone/assign', requireAuth, (req, res) => {
  const { agentId } = req.body;
  const lead = db.getLead(req.params.phone);
  if (!lead) return res.status(404).json({ error: 'lead not found' });
  const me = req.session.agent;
  if (me.role !== 'admin' && lead.assigned_to !== me.id)
    return res.status(403).json({ error: 'לא מורשה' });
  db.assignLead(req.params.phone, agentId || null);
  res.json({ success: true });
});

app.get('/api/leads/:phone/notes', requireAuth, (req, res) =>
  res.json(db.getNotes(req.params.phone))
);
app.post('/api/leads/:phone/notes', requireAuth, (req, res) => {
  const { text } = req.body;
  if (!text?.trim()) return res.status(400).json({ error: 'text required' });
  db.addNote(req.params.phone, req.session.agent.id, text.trim());
  res.json({ success: true });
});

// ── Agents ────────────────────────────────────────────
app.get('/api/agents', requireAuth, (req, res) =>
  res.json(db.getAllAgents())
);

// ── Courses ───────────────────────────────────────────
const storage = multer.diskStorage({
  destination: COURSE_DIR,
  filename: (req, file, cb) => {
    const idx = req.params.index;
    const ext = path.extname(file.originalname).toLowerCase();
    ['pdf','docx','txt'].forEach(e => {
      const old = path.join(COURSE_DIR, `course_${idx}.${e}`);
      if (fs.existsSync(old)) fs.unlinkSync(old);
    });
    cb(null, `course_${idx}${ext}`);
  },
});
const upload = multer({ storage, fileFilter: (req, file, cb) => {
  ['.pdf','.docx','.txt'].includes(path.extname(file.originalname).toLowerCase())
    ? cb(null, true) : cb(new Error('סוג קובץ לא נתמך'));
}, limits: { fileSize: 10 * 1024 * 1024 } });

app.get('/api/courses', requireAuth, (req, res) => {
  res.json(COURSES.map((name, i) => ({ index: i+1, name, file: getCourseFileInfo(i+1) })));
});

app.post('/api/courses/:index/upload', requireAuth, requireAdmin, (req, res) => {
  upload.single('file')(req, res, err => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'לא נבחר קובץ' });
    res.json({ success: true, filename: req.file.filename });
  });
});

app.delete('/api/courses/:index/file', requireAuth, requireAdmin, (req, res) => {
  ['pdf','docx','txt'].forEach(e => {
    const p = path.join(COURSE_DIR, `course_${req.params.index}.${e}`);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  });
  res.json({ success: true });
});

// ── Start ─────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🚀 שרת פועל על http://localhost:${PORT}`);
  console.log('📱 מאתחל 3 מספרי WhatsApp...\n');
  initAllBots();

  if (process.env.RAILWAY_PUBLIC_DOMAIN) {
    console.log(`\n🌐 כתובת אונליין: https://${process.env.RAILWAY_PUBLIC_DOMAIN}\n`);
  } else {
    try {
      const localtunnel = require('localtunnel');
      localtunnel({ port: PORT, subdomain: 'hamdan-leads' }).then(tunnel => {
        console.log(`\n🔗 כתובת אונליין: ${tunnel.url}\n`);
        tunnel.on('close', () => console.log('⚠️  Tunnel נסגר'));
      }).catch(err => console.log('⚠️  Tunnel לא הופעל:', err.message));
    } catch (err) {
      console.log('⚠️  Tunnel לא הופעל:', err.message);
    }
  }
});
