const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const db = require('./db');
const { handleMessage } = require('./conversation');

let client = null;
let qrCodeData = null;
let botStatus = 'disconnected';

function createClient() {
  client = new Client({
    authStrategy: new LocalAuth({ dataPath: './.wwebjs_auth' }),
    puppeteer: {
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    },
  });

  client.on('qr', (qr) => {
    qrCodeData = qr;
    botStatus = 'qr_ready';
    qrcode.generate(qr, { small: true });
    console.log('QR Code מוכן - סרוק אותו בוואטסאפ');
  });

  client.on('ready', () => {
    botStatus = 'connected';
    qrCodeData = null;
    console.log('✅ WhatsApp מחובר ופועל!');
  });

  client.on('disconnected', (reason) => {
    botStatus = 'disconnected';
    console.log('⚠️  WhatsApp התנתק:', reason);
  });

  client.on('message', async (msg) => {
    if (msg.isGroupMsg) return;

    const phone = msg.from.replace('@c.us', '');
    const text  = msg.body;

    console.log(`📩 הודעה נכנסת | ${phone} | "${text}"`);

    // הודעת פתיחה מהקמפיין
    const OPENING_MSG = 'hello! can i get more info on this?';
    const normalized  = text.trim().toLowerCase();
    const isOpening   = normalized.includes(OPENING_MSG);

    console.log(`🔍 normalized: "${normalized}"`);
    console.log(`✅ isOpening: ${isOpening}`);

    const existingLead = db.getLead(phone);

    // ליד חדש שלא שלח את הודעת הפתיחה – התעלם
    if (!existingLead && !isOpening) {
      console.log(`⛔ ליד חדש ללא הודעת פתיחה – מתעלם`);
      return;
    }

    db.saveMessage(phone, 'in', text);
    db.saveLead(phone);

    const lead = db.getLead(phone);

    // ליד סגור – הבוט לא מגיב
    if (lead && lead.status === 'closed') return;

    const result = await handleMessage(phone, text);

    if (result.update) {
      const u = result.update;
      db.updateLead(
        phone,
        u.name         ?? null,
        u.location     ?? null,
        u.contactPhone ?? null,
        u.course       ?? null,
        u.status       ?? null,
      );
    }

    // ליד חזר עם פנייה חדשה — הוסף הערה אוטומטית
    if (result.reopen) {
      db.addNote(phone, null, `📩 פנייה חדשה מהליד:\n"${text}"`);
      console.log(`🔔 פנייה חדשה מ-${phone}: "${text}"`);
    }

    if (result.reply) {
      await msg.reply(result.reply);
      db.saveMessage(phone, 'out', result.reply);
    }
  });

  client.initialize();
}

function getStatus() {
  return { status: botStatus, qr: qrCodeData };
}

async function sendMessage(phone, text) {
  if (!client || botStatus !== 'connected') throw new Error('Bot not connected');
  const chatId = phone.includes('@c.us') ? phone : `${phone}@c.us`;
  await client.sendMessage(chatId, text);
}

module.exports = { createClient, getStatus, sendMessage };
