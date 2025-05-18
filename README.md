# StegoChat 🦕

**StegoChat** is a secure messaging prototype (see ⚠️ [Warning](#warning)) that combines steganography with a double ratchet encryption mechanism. Messages are embedded into PNG images, encrypted with evolving keys, and exchanged manually between peers. The system is fully decentralised and runs entirely within the browser.

## What is Steganography

Steganography is the practice of hiding information in plain sight. Instead of scrambling a message so it looks like gibberish (encryption), steganography hides the fact that a message exists at all.

- **No obvious signal**: Encrypted text stands out. A steganographic image looks like any other picture.
- **No infrastructure**: You can send the image however you like - email, USB stick, print it out.
- **Psychological cover**: The message is concealed not behind a lock, but behind plausible normality.

StegoChat combines this with encryption, so even if someone does extract the hidden data, they still can’t read it without the cryptographic key.

## Features

- [Double Ratchet key exchange](https://signal.org/docs/specifications/doubleratchet/) providing forward secrecy  
- Message embedding via [LSB steganography](https://en.wikipedia.org/wiki/Steganography#Digital_steganography) in PNG files  
- Peer-to-peer operation with no backend or network transport  
- QR-based key exchange to initialise sessions  
- Local state and history with ratchet continuation (stored via [IndexedDB](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API))  
- Entirely client-side; no data leaves the browser unless the user explicitly shares it

## GitHub Pages

This project is deployed using [GitHub Pages](https://pages.github.com/) at:

**https://andymacdroo.github.io/stego-chat/**

## Protocol Overview

1. **Initiator creates a conversation**
   - Generates a keypair and a unique conversation ID
   - Displays a QR code containing their public key and the conversation ID

2. **Responder scans the QR code**
   - Imports the initiator's public key
   - Derives a shared secret and sets up the ratchet
   - Generates their own public key and responds by displaying a second QR code

3. **Initiator scans the responder's QR code**
   - Completes the ratchet exchange using the responder's public key
   - Both parties now share a synchronised ratchet state

4. **Message exchange**
   - To send: type a message, select a PNG image, and download the encoded file
   - To receive: select a received PNG file, decode and decrypt the embedded message
   - Each message exchange advances the relevant ratchet chain

## Usage

### Development

```bash
npm install
npm run dev
```

### Testing

Playwright is used for end-to-end tests:

```bash
npm run test:setup
npm run test
```

### Build

```bash
npm run build
```

## Warning

⚠️ - StegoChat is a **demo** project. It is **not** suitable for use in real-world secure communication scenarios.

- The cryptographic model is simplified and lacks formal verification
- The steganographic method is not resistant to statistical analysis or tampering
- There is no authentication, identity verification, or message integrity checking beyond encryption
- Files must be exchanged manually, introducing potential side-channel or operational security risks

**Do not** use this system to transmit sensitive, personal, or confidential information.
