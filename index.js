import dotenv from 'dotenv';
dotenv.config();

import WebSocket from 'ws';
import axios from 'axios';

const HELIUS_KEY = process.env.HELIUS_API_KEY;
const SHYFT_API_KEY = process.env.SHYFT_API_KEY;

const seenMints = new Set();
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
    console.log('🧩 Subscribed to ALL logs');

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
      const signature = parsed?.params?.result?.value?.signature;

      if (!signature) return;

      const mintAddress = await extractTokenAddressFromTx(signature);
      if (!mintAddress || seenMints.has(mintAddress)) return;

      const isPonzi = await hasPonziFee(mintAddress);
      if (isPonzi) {
        seenMints.add(mintAddress);

        const solscanLink = `https://solscan.io/tx/${signature}`;
        telegramQueue.push(
          `⚡ <b>Ponzi Token Detected</b>
<b>Mint:</b> <code>${mintAddress}</code>
🔗 <a href="${solscanLink}">View on Solscan</a>`
        );
        processTelegramQueue();
      }
    } catch (err) {
      console.warn('⚠️ Invalid message:', data.toString().slice(0, 300));
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
    console.log(`🔍 Fee for ${mintAddress}: ${fee}%`);
    return fee >= 8 && fee <= 12;
  } catch (err) {
    console.error('❌ Shyft fee check failed:', err.message);
    return false;
  }
}

async function extractTokenAddressFromTx(signature) {
  try {
    const { data } = await axios.post(
      `https://api.helius.xyz/v0/transactions/?api-key=${HELIUS_KEY}`,
      {
        transactionSignatures: [signature],
      }
    );

    const accounts = data?.[0]?.accounts || [];
    const possibleMint = accounts.find((acc) =>
      acc.owner?.includes('Token') && acc?.account
    );
    return possibleMint?.account || null;
  } catch (err) {
    console.warn('❓ Failed to extract token address:', err.message);
    return null;
  }
}

startWebSocket();
