// test.js
const str1 = "Bitcoin Price at 8:20 AM ET";
const str2 = "Bitcoin Up or Down - March 22, 8:15AM-8:20AM ET";
const timeRegex = /\b\d{1,2}:\d{2}\s*(?:AM|PM)?\s*ET\b/i;

console.log("str1 match:", timeRegex.test(str1));
console.log("str2 match:", timeRegex.test(str2));

import { getBitcoinMarkets } from './src/services/crypto-service.js';
getBitcoinMarkets().then(m => console.log("Markets returned:", m.length)).catch(console.error);
