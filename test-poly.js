const WebSocket = require('ws');

const TOKEN_ID = '82014787021606192440558641094142993330586914659490933667373385650704452291505';

const ws = new WebSocket('wss://ws-subscriptions-clob.polymarket.com/ws/market');

ws.on('open', () => {
  console.log('[+] Connected');
  const msg1 = {
    type: 'market',
    asset_ids: [TOKEN_ID],
    custom_feature_enabled: true
  };
  ws.send(JSON.stringify(msg1));
  console.log('[+] Sent subscribe:', msg1);

  // Also try asset_ids vs assets_ids
  const msg2 = {
    type: 'market',
    assets_ids: [TOKEN_ID]
  };
  ws.send(JSON.stringify(msg2));
  console.log('[+] Sent subscribe:', msg2);

});

ws.on('message', m => {
  console.log('[MSG]', m.toString());
});

setTimeout(() => {
    console.log('Timeout. Exiting.');
    ws.close();
    process.exit(0);
}, 10000); // 10s wait

ws.on('close', () => console.log('[-] Closed'));
ws.on('error', e => console.error('[!] Error:', e));
