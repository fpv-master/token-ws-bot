import dotenv from 'dotenv';
dotenv.config();

import WebSocket from 'ws';
import axios from 'axios';

const HELIUS_KEY = process.env.HELIUS_API_KEY;

function startWebSocket() {
  const ws = new WebSocket(`wss://rpc.helius.xyz/?api-key=${HELIUS_KEY}`);
  let pingInterval = null;

  ws.on('open', () => {
    console.log('✅ WebSocket connected to Helius');

    // Подписка на ВСЕ транзакции
    const subscribeMessage = {
      jsonrpc: '2.0',
      id: 1,
      method: 'logsSubscribe',
      params: [
        'all',
        {
          commitment: 'confirmed',
          encoding: 'json',
        },
      ],
    };

    ws.send(JSON.stringify(subscribeMessage));
    console.log('🧩 Sent logsSubscribe to ALL logs');

    // Ping, чтобы соединение не рвалось
    pingInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.ping();
        console.log('📡 Sent ping');
      }
    }, 3000);
  });

  ws.on('message', async (data) => {
    const parsed = JSON.parse(data.toString());
    console.log('📥 INCOMING:', JSON.stringify(parsed, null, 2));

    const logs = parsed?.params?.result?.value?.logs || [];
    const signature = parsed?.params?.result?.value?.signature;

    const hasInitMint = logs.some((log) => log.includes('InitializeMint2'));

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
    if (pingInterval) clearInterval(pingInterval);
    setTimeout(startWebSocket, 5000);
  });

  ws.on('error', (err) => {
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
