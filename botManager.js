const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const db = require('./db');
const { handleMessage } = require('./conversation');
const fs   = require('fs');
const path = require('path');

const BOT_COUNT = 3;

// { 1: { client, status, qr, number, name }, ... }
const bots = {};
for (let i = 1; i <= BOT_COUNT; i++) {
  bots[i] = { client: null, status: 'disconnected', qr: null, number: null, name: `מספר ${i}` };
}

function createBotClient(botId) {
  const bot = bots[botId];
  if (!bot) return;

  const client = new Client({
    authStrategy: new LocalAuth({
      dataPath: './.wwebjs_auth',
      clientId: `bot${botId}`,
    }),
    puppeteer: {
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    },
  });

  bot.client = client;
  bot.status  = 'initializing';

  client.on('qr', (qr) => {
    bot.qr     = qr;
    bot.status = 'qr_ready';
    qrcode.generate(qr, { small: true });
    console.log(`[Bot ${botId}] QR Code מוכן`);
  });

  client.on('ready', () => {
    bot.status = 'connected';
    bot.qr     = null;
    bot.number = client.info?.wid?.user || null;
    console.log(`[Bot ${botId}] ✅ מחובר! | ${bot.number}`);
  });

  client.on('auth_failure', (msg) => {
    bot.status = 'disconnected';
    console.log(`[Bot ${botId}] ❌ שגיאת אימות:`, msg);
  });

  client.on('disconnected', (reason) => {
    bot.status = 'disconnected';
    bot.number = null;
    console.log(`[Bot ${botId}] ⚠️ התנתק:`, reason);
  });

  client.on('message', async (msg) => {
    if (msg.isGroupMsg) return;
    const phone = msg.from.replace('@c.us', '');
    const text  = msg.body;
    console.log(`[Bot ${botId}] 📩 ${phone} | "${text}"`);

    const OPENING_MSG = 'hello! can i get more info on this?';
    const isOpening   = text.trim().toLowerCase().includes(OPENING_MSG);
    const existingLead = db.getLead(phone);

    if (!existingLead && !isOpening) return;

    db.saveMessage(phone, 'in', text);
    db.saveLead(phone, botId);

    const lead = db.getLead(phone);
    if (lead?.status === 'closed') return;

    const result = await handleMessage(phone, text);

    if (result.update) {
      const u = result.update;
      db.updateLead(phone, u.name ?? null, u.location ?? null, u.contactPhone ?? null, u.course ?? null, u.status ?? null);
    }

    if (result.reopen) {
      db.addNote(phone, null, `📩 פנייה חדשה מהליד:\n"${text}"`);
      console.log(`[Bot ${botId}] 🔔 פנייה חדשה מ-${phone}`);
    }

    if (result.reply) {
      await msg.reply(result.reply);
      db.saveMessage(phone, 'out', result.reply);
    }
  });

  client.initialize().catch(err => {
    console.log(`[Bot ${botId}] ⚠️ שגיאה באתחול, מנסה שוב בעוד 5 שניות...`, err.message);
    bot.status = 'disconnected';
    setTimeout(() => {
      try { client?.destroy(); } catch {}
      bot.client = null;
      createBotClient(botId);
    }, 5000);
  });
}

function initAllBots() {
  for (let i = 1; i <= BOT_COUNT; i++) createBotClient(i);
}

function getBotStatus(botId) {
  const bot = bots[botId];
  if (!bot) return null;
  return { id: botId, name: bot.name, status: bot.status, qr: bot.qr, number: bot.number };
}

function getAllBotsStatus() {
  return Object.keys(bots).map(id => getBotStatus(parseInt(id)));
}

async function disconnectBot(botId) {
  const bot = bots[botId];
  if (!bot) return;
  if (bot.client) {
    try { await bot.client.logout(); }  catch {}
    try { await bot.client.destroy(); } catch {}
    bot.client = null;
  }
  bot.status = 'disconnected';
  bot.qr     = null;
  bot.number = null;
  const sessionPath = path.join(__dirname, '.wwebjs_auth', `session-bot${botId}`);
  if (fs.existsSync(sessionPath)) fs.rmSync(sessionPath, { recursive: true, force: true });
}

async function connectBot(botId) {
  const bot = bots[botId];
  if (!bot) return;
  if (bot.client) {
    try { await bot.client.destroy(); } catch {}
    bot.client = null;
  }
  createBotClient(botId);
}

async function sendMessage(phone, text) {
  // שלח דרך הבוט שממנו הגיע הליד, אם לא — דרך כל בוט מחובר
  const lead = db.getLead(phone);
  const targetId = lead?.bot_id || null;
  const targetBot = targetId ? bots[targetId] : null;

  const bot = (targetBot?.status === 'connected' ? targetBot : null)
    || Object.values(bots).find(b => b.status === 'connected');

  if (!bot) throw new Error('אין בוט מחובר');
  const chatId = phone.includes('@c.us') ? phone : `${phone}@c.us`;
  await bot.client.sendMessage(chatId, text);
}

module.exports = { initAllBots, connectBot, disconnectBot, getBotStatus, getAllBotsStatus, sendMessage, BOT_COUNT };
