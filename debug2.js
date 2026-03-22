import { getBitcoinMarkets } from './src/services/crypto-service.js';
getBitcoinMarkets().then(m => console.log("Markets:", m.length)).catch(console.error);
