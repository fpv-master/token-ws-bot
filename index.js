import dotenv from 'dotenv';
dotenv.config();

import WebSocket from 'ws';
import axios from 'axios';

const HELIUS_KEY = process.env.HELIUS_API_KEY;

function startWebSocket() {
  const ws = new WebSocket(`wss://rpc.helius.xyz/?api-key=${HELIUS_KEY}`);

  ws.on('open', () => {
    console.log('✅ WebSocket connected to Helius');

    const subscribeMessage = {
      jsonrpc: "2.0",
      id: 1,
      method: "logsSubscribe",
      params: [
        {}, // No filter
        {
          commitment: "confirmed",
          encoding: "json"
        }
      ]
    };

    ws.send(JSON.stringify(subscribeMessage));
    console.log('🧩 Sent logsSubscribe without filters');
  });

  ws.on('message', async (data) => {
    const parsed = JSON.parse(data.toString());
    console.log('📥 INCOMING:', JSON.stringify(parsed, null, 2));

    const logs = parsed?.params?.result?.value?.logs || [];
    const signature = parsed?.params?.result?.value?.signature;

    const hasInitMint = logs.some(log => log.includes('InitializeMint2'));

    if (hasInitMint) {
      const solscanLink = `https://solscan.io/tx/${signature}`;
      console.log('⚡ New token with InitializeMint2');
      console.log('🔗', solscanLink);

      await sendToTelegram(`⚡ <b>New Token Created</b>
🔗 <a href="${solscanLink}">View on Solscan</a>`);
    }
  });

  ws.on('close', () => {
    console.log('❌ WebSocket closed. Reconnecting in 5s...');
    setTimeout(startWebSocket, 5000);
  });

  ws.on('error', err => {
    console.error('💥 WebSocket error:', err.message);
  });
}

startWebSocket();

async function sendToTelegram(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  const url = `https://api.telegram.org/bot${token}/sendMessage`;

  try {
    await axios.post(url, {
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
    });
  } catch (e) {
    console.error('Telegram error:', e.response?.data || e.message);
  }
}
