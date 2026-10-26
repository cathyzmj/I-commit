// Makes a key pair for push notifications. Run once, then store both as Worker secrets:
//   node scripts/vapid-keys.mjs
//   npx wrangler secret put VAPID_PUBLIC_KEY
//   npx wrangler secret put VAPID_PRIVATE_KEY
// Keep the same pair: a new one stops every device's notifications until each turns them on again.
const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const pub = Buffer.from(await crypto.subtle.exportKey('raw', pair.publicKey)).toString('base64url');
const priv = (await crypto.subtle.exportKey('jwk', pair.privateKey)).d;
console.log(`VAPID_PUBLIC_KEY=${pub}\nVAPID_PRIVATE_KEY=${priv}`);
