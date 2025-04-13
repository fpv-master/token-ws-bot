import dotenv from 'dotenv';
dotenv.config();

import WebSocket from 'ws';

const HELIUS_KEY = process.env.HELIUS_API_KEY;
const TOKEN_2022_PROGRAM_ID = 'TokenzQdMSrUjYk5RhTKNvGJLuNKXytmB1fY7uQhHT';

const ws = new WebSocket(`wss://rpc.helius.xyz/?api-key=${HELIUS_KEY}`);

ws.on('open', () => {
  console.log('✅ WebSocket connected to Helius');

  ws.send(JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "logsSubscribe",
    params: [
      {
        mentions: [TOKEN_2022_PROGRAM_ID]
      },
      {
        commitment: "confirmed",
        encoding: "jsonParsed"
      }
    ]
  }));
});

ws.on('message', async (data) => {
  const parsed = JSON.parse(data.toString());
  const logs = parsed?.params?.result?.value?.logs || [];
  const signature = parsed?.params?.result?.value?.signature;

  const hasInitMint = logs.some(log => log.includes('InitializeMint2'));

  if (hasInitMint) {
    console.log('⚡ New token with InitializeMint2');
    console.log('🔗 https://solscan.io/tx/' + signature);
    // TODO: Add Telegram notification here
  }
});

ws.on('close', () => console.log('❌ WebSocket closed'));
ws.on('error', err => console.error('💥 WebSocket error:', err.message));
