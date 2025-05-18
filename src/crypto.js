export async function generateKeyPair() {
  return await crypto.subtle.generateKey(
    {
      name: 'ECDH',
      namedCurve: 'P-256'
    },
    true,
    ['deriveKey', 'deriveBits']
  );
}

export async function exportPublicKey(key) {
  const raw = await crypto.subtle.exportKey('raw', key);
  return btoa(String.fromCharCode(...new Uint8Array(raw)));
}

export async function importPublicKey(base64) {
  const raw = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
  return await crypto.subtle.importKey(
    'raw',
    raw,
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    []
  );
}

export async function deriveSharedKey(privateKey, publicKey) {
  const derivedKey = await crypto.subtle.deriveBits(
    {
      name: 'ECDH',
      public: publicKey
    },
    privateKey,
    256
  );
  return new Uint8Array(derivedKey);
}

export async function encryptMessage(text, ratchetKey) {
  const key = await crypto.subtle.importKey('raw', ratchetKey, { name: 'AES-GCM' }, false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(text);
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoded
  );
  const combined = new Uint8Array(iv.length + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), iv.length);
  return combined;
}

export async function decryptMessage(data, ratchetKey) {
  const key = await crypto.subtle.importKey('raw', ratchetKey, { name: 'AES-GCM' }, false, ['decrypt']);
  const iv = data.slice(0, 12);
  const ciphertext = data.slice(12);
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    ciphertext
  );
  return new TextDecoder().decode(plaintext);
}

export async function hkdf(secret, salt, info, length = 32) {
  const key = await crypto.subtle.importKey("raw", secret, "HKDF", false, ["deriveBits"]);
  const derived = await crypto.subtle.deriveBits(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: salt,
      info: new TextEncoder().encode(info)
    },
    key,
    length * 8
  );
  return new Uint8Array(derived);
}

export async function hmac(key, data) {
  const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", k, data);
  return new Uint8Array(sig).slice(0, 32);
}

export async function advanceRatchet(chainKey, stepLabel) {
  const salt = new Uint8Array(32).fill(0); 
  const info = `ratchet-key-derivation-${stepLabel}`;

  const derivedMaterial = await hkdf(chainKey, salt, info, 64);

  if (derivedMaterial.byteLength < 64) {
    throw new Error("HKDF did not produce enough bytes for ratchet advancement.");
  }

  return {
    key: derivedMaterial.slice(0, 32),
    chain: derivedMaterial.slice(32, 64)
  };
}
