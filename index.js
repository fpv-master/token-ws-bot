import dotenv from 'dotenv';
dotenv.config();

import WebSocket from 'ws';
import axios from 'axios';

const HELIUS_KEY = process.env.HELIUS_API_KEY;

// Храним уже отправленные сигнатуры, чтобы не спамить
const seenSignatures = new Set();

function startWebSocket() {
  const ws = new WebSocket(`wss://rpc.helius.xyz/?api-key=${HELIUS_KEY}`);
  let pingInterval = null;

  ws.on('open', () => {
    console.log('✅ WebSocket connected to Helius');

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

    pingInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.ping();
        console.log('📡 Sent ping');
      }
    }, 3000);
  });

  ws.on('message', async (data) => {
    try {
      const parsed = JSON.parse(data.toString());

      const logs = parsed?.params?.result?.value?.logs || [];
      const signature = parsed?.params?.result?.value?.signature;

      // Строгое совпадение по строке
      const hasInitMint = logs.some(
        (log) => log.trim() === 'Program log: Instruction: InitializeMint2'
      );

      // Проверяем уникальность сигнатуры
      if (hasInitMint && !seenSignatures.has(signature)) {
        seenSignatures.add(signature);

        const solscanLink = `https://solscan.io/tx/${signature}`;
        console.log('⚡ New token with InitializeMint2');
        console.log('🔗', solscanLink);

        await sendToTelegram(`⚡ <b>New Token Created</b>
🔗 <a href="${solscanLink}">View on Solscan</a>`);
      }
    } catch (err) {
      console.warn('⚠️ Invalid JSON in message:', data.toString().slice(0, 300));
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
