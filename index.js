import dotenv from 'dotenv';
dotenv.config();

import WebSocket from 'ws';
import axios from 'axios';

const HELIUS_KEY = process.env.HELIUS_API_KEY;
const SHYFT_API_KEY = process.env.SHYFT_API_KEY;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

const seenMints = new Set();
const queue = [];
let isProcessing = false;

function startWebSocket() {
  const ws = new WebSocket(`wss://rpc.helius.xyz/?api-key=${HELIUS_KEY}`);
  let pingInterval = null;

  ws.on('open', () => {
    console.log('✅ Connected to Helius WebSocket');
    ws.send(JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'logsSubscribe',
      params: ['all', { commitment: 'confirmed', encoding: 'json' }]
    }));
    console.log('📡 Subscribed to all logs');

    pingInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.ping();
        console.log('📶 Ping');
      }
    }, 3000);
  });

  ws.on('message', async (msg) => {
    try {
      const data = JSON.parse(msg);
      const sig = data?.params?.result?.value?.signature;
      if (sig && !queue.includes(sig)) {
        queue.push(sig);
        processQueue();
      }
    } catch {}
  });

  ws.on('close', () => {
    console.log('❌ WebSocket closed. Reconnecting...');
    if (pingInterval) clearInterval(pingInterval);
    setTimeout(startWebSocket, 5000);
  });

  ws.on('error', (e) => console.error('💥 WebSocket error:', e.message));
}

async function processQueue() {
  if (isProcessing || queue.length === 0) return;

  isProcessing = true;
  const sig = queue.shift();

  try {
    const mint = await extractMintFromTx(sig);
    if (mint && !seenMints.has(mint)) {
      seenMints.add(mint);
      const isPonzi = await checkPonziFee(mint);
      if (isPonzi) {
        await sendTelegram(
          `⚠️ <b>Ponzi Token Found</b>
<code>${mint}</code>
🔗 <a href="https://solscan.io/tx/${sig}">Solscan</a>`
        );
      }
    }
  } catch (e) {
    console.warn('⚠️ Processing error:', e.message);
  }

  setTimeout(() => {
    isProcessing = false;
    processQueue();
  }, 300);
}

async function extractMintFromTx(sig) {
  try {
    const { data } = await axios.post(
      `https://api.helius.xyz/v0/transactions/?api-key=${HELIUS_KEY}`,
      { transactionSignatures: [sig] }
    );
    const accounts = data?.[0]?.accounts || [];
    const mint = accounts.find(
      (acc) => acc.owner?.includes('Token') && acc.account
    );
    return mint?.account || null;
  } catch (e) {
    console.warn('❓ extractMintFromTx error:', e.message);
    return null;
  }
}

async function checkPonziFee(mint) {
  try {
    const { data } = await axios.get('https://api.shyft.to/sol/v1/token/get_info', {
      params: { network: 'mainnet-beta', token_address: mint },
      headers: { 'x-api-key': SHYFT_API_KEY },
    });
    const bps = data.result?.extensions?.transfer_fee_config?.transfer_fee_basis_points;
    const fee = bps ? bps / 100 : 0;
    console.log(`🧪 ${mint} fee = ${fee}%`);
    return fee >= 8 && fee <= 12;
  } catch (e) {
    console.warn('💥 Shyft error:', e.message);
    return false;
  }
}

async function sendTelegram(text) {
  try {
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    await axios.post(url, {
      chat_id: TELEGRAM_CHAT_ID,
      text,
      parse_mode: 'HTML',
    });
  } catch (e) {
    console.warn('📵 Telegram error:', e.response?.data || e.message);
  }
}

startWebSocket();