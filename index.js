import dotenv from 'dotenv';
dotenv.config();

import WebSocket from 'ws';
import axios from 'axios';

const HELIUS_KEY = process.env.HELIUS_API_KEY;
const SHYFT_API_KEY = process.env.SHYFT_API_KEY;

const seenSignatures = new Set();
const telegramQueue = [];
let isSending = false;

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

      const hasExactMint2 = logs.some(
        (log) => log.trim() === 'Program log: Instruction: InitializeMint2'
      );

      if (hasExactMint2 && !seenSignatures.has(signature)) {
        seenSignatures.add(signature);

        // Пробуем найти адрес токена из logs
        const mintLog = logs.find((log) =>
          log.includes('mint') || log.includes('Mint') || log.includes('Mint2')
        );
        console.log('📄 Mint2 Detected. Trying Shyft check...');

        // Telegram уведомление только если fee 8-12%
        const mintAddress = await extractTokenAddressFromTx(signature);
        if (mintAddress && (await hasPonziFee(mintAddress))) {
          const solscanLink = `https://solscan.io/tx/${signature}`;
          telegramQueue.push(
            `⚡ <b>Ponzi Token Detected</b>
<b>Mint:</b> <code>${mintAddress}</code>
🔗 <a href="${solscanLink}">View on Solscan</a>`
          );
          processTelegramQueue();
        } else {
          console.log('⛔ Fee not in range 8–12% or no mint address.');
        }
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

function processTelegramQueue() {
  if (isSending || telegramQueue.length === 0) return;

  isSending = true;
  const text = telegramQueue.shift();

  sendToTelegram(text).finally(() => {
    setTimeout(() => {
      isSending = false;
      processTelegramQueue();
    }, 2000);
  });
}

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

// Проверка через Shyft — fee между 8 и 12%
async function hasPonziFee(mintAddress) {
  try {
    const { data } = await axios.get('https://api.shyft.to/sol/v1/token/get_info', {
      params: {
        network: 'mainnet-beta',
        token_address: mintAddress,
      },
      headers: {
        'x-api-key': SHYFT_API_KEY,
      },
    });

    const feeBps = data.result?.extensions?.transfer_fee_config?.transfer_fee_basis_points;
    const fee = feeBps ? feeBps / 100 : 0;
    return fee >= 8 && fee <= 12;
  } catch (err) {
    console.error('🔍 Shyft fee check failed:', err.message);
    return false;
  }
}

// Примерная попытка достать адрес минта (можно заменить на реальный парсер из Helius API)
async function extractTokenAddressFromTx(signature) {
  try {
    const { data } = await axios.get(
      `https://api.helius.xyz/v0/transactions/?api-key=${HELIUS_KEY}`,
      {
        params: { transactionSignatures: [signature] },
      }
    );

    const accounts = data?.[0]?.accounts || [];
    const possibleMint = accounts.find((acc) => acc.owner?.includes('Token') && acc?.account);
    return possibleMint?.account || null;
  } catch (err) {
    console.warn('❓ Failed to extract token address:', err.message);
    return null;
  }
}

startWebSocket();
