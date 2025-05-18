
import { BrowserQRCodeReader } from '@zxing/browser';
import { Image as ImageIcon, QrCode as QrCodeIcon, Upload as UploadIcon } from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';
import QRCode from 'react-qr-code';

import {
    advanceRatchet,
    decryptMessage,
    deriveSharedKey,
    encryptMessage,
    exportPublicKey,
    generateKeyPair,
    hkdf,
    importPublicKey
} from './crypto';

import { clearConversations, loadConversations, saveConversation } from './db';
import { decodeMessageFromImage, encodeMessageInImage, } from './stego';

export default function StegoChatApp() {
    const [conversations, setConversations] = useState({});
    const [activeId, setActiveId] = useState(null);

    const [showScanner, setShowScanner] = useState(false);
    const [message, setMessage] = useState('');
    const qrVideoRef = useRef(null);

    const [keyPair, setKeyPair] = useState(null);
    const [qrPublicKey, setQrPublicKey] = useState('');

    const [ratchets, setRatchets] = useState({});

    const [pendingConversationId, setPendingConversationId] = useState(null);

    useEffect(() => {
        if (typeof window !== 'undefined' && window.__TEST_MODE) {
            window.__processQrPayload = async (payload) => {
                try {
                    await processQrPayload(payload);
                } catch (err) {
                    console.error('QR payload processing failed:', err);
                }
            };
        }
    }, [keyPair, pendingConversationId, conversations]);

    useEffect(() => {
        if (typeof window !== 'undefined' && window.__TEST_MODE) {
            if (qrPublicKey && (pendingConversationId || activeId)) {
                window.__qrPayload = JSON.stringify({
                    publicKey: qrPublicKey,
                    conversationId: pendingConversationId || activeId
                });
            }
        }
    }, [qrPublicKey, pendingConversationId, activeId]);

    useEffect(() => {
        if (typeof window !== 'undefined' && window.__TEST_MODE) {
            window.__ratchets = ratchets;
            window.__activeId = activeId;
        }
    }, [ratchets, activeId]);

    useEffect(() => {
        (async () => {
            const kp = await generateKeyPair();
            setKeyPair(kp);
            const exported = await exportPublicKey(kp.publicKey);
            setQrPublicKey(exported);
            const list = await loadConversations();
            const mapped = {};
            const restoredRatchets = {};

            for (const c of list) {
                mapped[c.id] = c;
                if (c.ratchet) {
                    restoredRatchets[c.id] = {
                        rootKey: new Uint8Array(c.ratchet.rootKey),
                        sendChain: new Uint8Array(c.ratchet.sendChain),
                        recvChain: new Uint8Array(c.ratchet.recvChain)
                    };
                }
            }
            setRatchets(restoredRatchets);
            setConversations(mapped);
        })();
    }, []);

    useEffect(() => {
        if (!showScanner) return;

        const codeReader = new BrowserQRCodeReader();
        let controls;

        (async () => {
            try {
                controls = await codeReader.decodeFromVideoDevice(
                    undefined,
                    qrVideoRef.current,
                    (result, _error, control) => {
                        if (result) {
                            handleScan(result.getText());
                            control.stop();
                        }
                    }
                );
            } catch (err) {
                console.error('QR scanner error:', err);
            }
        })();

        return () => {
            if (controls) controls.stop();
        };
    }, [showScanner]);

    const processQrPayload = async (scannedPayload) => {
        try {
            if (!keyPair || !scannedPayload) return;

            let parsed;
            try {
                parsed = JSON.parse(scannedPayload);
            } catch {
                alert('Invalid QR code format');
                return;
            }

            const { publicKey, conversationId: scannedId } = parsed;
            if (!publicKey || !scannedId) {
                alert('Missing public key or conversation ID in QR');
                return;
            }

            const theirPublicKey = await importPublicKey(publicKey);
            const myPublicKey = await exportPublicKey(keyPair.publicKey);

            const id = pendingConversationId || scannedId;
            const isResponder = !pendingConversationId && !(scannedId in conversations);

            const sharedSecret = await deriveSharedKey(keyPair.privateKey, theirPublicKey);
            const rootKey = await hkdf(sharedSecret, new Uint8Array(32), 'root');
            const sendLabel = isResponder ? 'recv' : 'send';
            const recvLabel = isResponder ? 'send' : 'recv';

            const sendChain = await hkdf(rootKey, new Uint8Array(32), sendLabel);
            const recvChain = await hkdf(rootKey, new Uint8Array(32), recvLabel);
            setRatchets(prev => ({
                ...prev,
                [id]: {
                    rootKey,
                    sendChain,
                    recvChain
                }
            }));

            const existing = conversations[id];
            if (existing) {
                const updated = {
                    ...existing,
                    theirPublicKey: publicKey,
                    ratchet: {
                        rootKey,
                        sendChain,
                        recvChain
                    }
                };

                await saveConversation(updated);
                setConversations(prev => ({ ...prev, [id]: updated }));
            } else if (isResponder) {
                const newEntry = {
                    id,
                    name: `Conversation ${Object.keys(conversations).length + 1}`,
                    theirPublicKey: publicKey,
                    myPublicKey,
                    role: 'responder',
                    history: [],
                    ratchet: {
                        rootKey,
                        sendChain,
                        recvChain
                    }
                };
                await saveConversation(newEntry);
                setConversations(prev => ({ ...prev, [id]: newEntry }));
                setActiveId(id);
            } else {
                alert('Cannot bind scan to unknown conversation');
                return;
            }

            setPendingConversationId(null);
            setShowScanner(false);
        } catch (err) {
            console.error(err);
            alert('Failed to process QR code');
        }
    }

    const handleScan = async (scannedPayload) => {
        await processQrPayload(scannedPayload);
    };

    const handleEncode = async (e) => {
        if (!ratchets[activeId]) {
            alert('Key exchange incomplete');
            return;
        }
        const file = e.target.files[0];
        if (!file || !activeId || !message) return;
        if (!file.type.startsWith('image/png') || file.size > 5 * 1024 * 1024) return;

        const ratchet = ratchets[activeId];
        const { key: messageKey, chain: updatedSendChain } = await advanceRatchet(ratchet.sendChain, 'stego');


        const updatedRatchet = {
            rootKey: ratchet.rootKey,
            sendChain: updatedSendChain,
            recvChain: ratchet.recvChain
        };

        setRatchets(prev => ({ ...prev, [activeId]: updatedRatchet }));

        const encrypted = await encryptMessage(message, messageKey);
        const len = encrypted.length;
        const header = new Uint8Array(2);
        header[0] = (len >> 8) & 0xff;
        header[1] = len & 0xff;

        const fullPayload = new Uint8Array(2 + len);
        fullPayload.set(header, 0);
        fullPayload.set(encrypted, 2);

        const binary = Array.from(fullPayload)
            .map(b => b.toString(2).padStart(8, '0'))
            .join('');

        window.__lastEncrypted = encrypted;

        const url = await encodeMessageInImage(file, binary);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'stego.png';
        a.click();

        const safeRatchet = {
            rootKey: Array.from(updatedRatchet.rootKey),
            sendChain: Array.from(updatedRatchet.sendChain),
            recvChain: Array.from(updatedRatchet.recvChain)
        };

        setConversations(prev => {
            const convo = prev[activeId];
            const updatedConversation = {
                ...convo,
                history: [...(convo.history || []), { type: 'sent', message, timestamp: Date.now(), reads: 0 }],
                ratchet: updatedRatchet
            };
            saveConversation({ ...updatedConversation, ratchet: safeRatchet });
            return { ...prev, [activeId]: updatedConversation };
        });
        e.target.value = ''
        setMessage('');
    };

    const handleDecode = async (e) => {
        const file = e.target.files[0];
        if (!file || !activeId) return;

        const encodedBytesWithHeader = await decodeMessageFromImage(file);
        console.log("Original (from sender's perspective, IV+Ciphertext):", window.__lastEncrypted);
        console.log("Decoded from image (Header+IV+Ciphertext):", encodedBytesWithHeader);

        if (!encodedBytesWithHeader || encodedBytesWithHeader.length < 2) {
            alert('Failed to decode message from image or decoded data is too short.');
            return;
        }

        try {
            const ratchet = ratchets[activeId];
            if (!ratchet || !ratchet.recvChain) {
                alert('Receiving chain not initialized. Complete key exchange.');
                return;
            }
            const { key: messageKey, chain: updatedRecvChain } = await advanceRatchet(ratchet.recvChain, 'stego');

            const actualEncryptedPayload = encodedBytesWithHeader;

            const decrypted = await decryptMessage(actualEncryptedPayload, messageKey);

            const updatedRatchet = {
                rootKey: ratchet.rootKey,
                sendChain: ratchet.sendChain,
                recvChain: updatedRecvChain
            };

            const safeRatchet = {
                rootKey: Array.from(updatedRatchet.rootKey),
                sendChain: Array.from(updatedRatchet.sendChain),
                recvChain: Array.from(updatedRatchet.recvChain)
            };

            setRatchets(prev => ({ ...prev, [activeId]: updatedRatchet }));

            setConversations(prev => {
                const convo = prev[activeId];
                const updatedConversation = {
                    ...convo,
                    history: [...(convo.history || []), { type: 'received', message: decrypted, timestamp: Date.now(), reads: 1 }],
                    ratchet: updatedRatchet
                };
                saveConversation({ ...updatedConversation, ratchet: safeRatchet });
                return { ...prev, [activeId]: updatedConversation };
            });

        } catch (err) {
            console.error('Decryption process failed:', err);
            alert('Decryption failed. This could be due to a key mismatch, corrupted image, or an issue in the crypto process.');
        } finally {
            e.target.value = '';
        }
    };


    return (
        <div className="px-2 w-full mx-auto font-sans text-gray-900 bg-white min-h-screen flex flex-col">
            <header className="flex justify-center items-center gap-2 py-4 border-b font-bold text-xl text-blue-700">
                StegoChat

            </header>

            <section className="px-2 py-4">
                <details className="w-full">
                    <summary className="text-lg font-semibold cursor-pointer mb-2">New Conversation</summary>
                    <div className="flex flex-col items-center space-y-3">
                        <div className="flex gap-3">
                            <button className="px-3 py-2 bg-blue-600 text-white rounded flex items-center gap-1" onClick={async () => {
                                const myPub = await exportPublicKey(keyPair.publicKey);
                                const id = Date.now().toString();

                                const rootKey = new Uint8Array(32);
                                const sendChain = await hkdf(rootKey, new Uint8Array(32), 'send');
                                const recvChain = await hkdf(rootKey, new Uint8Array(32), 'recv');

                                const entry = {
                                    id,
                                    name: `Conversation ${Object.keys(conversations).length + 1}`,
                                    myPublicKey: myPub,
                                    theirPublicKey: null,
                                    history: [],
                                    ratchet: { rootKey, sendChain, recvChain }
                                };
                                setRatchets(prev => ({ ...prev, [id]: { rootKey, sendChain, recvChain } }));
                                await saveConversation(entry);
                                setConversations(prev => ({ ...prev, [id]: entry }));
                                setActiveId(id);
                            }}>
                                <QrCodeIcon className="w-4 h-4" /> Create
                            </button>
                            <button className="px-3 py-2 bg-gray-200 text-black rounded flex items-center gap-1" onClick={() => {
                                setPendingConversationId(activeId);
                                setShowScanner(true)
                            }
                            }>
                                <UploadIcon className="w-4 h-4" /> Scan
                            </button>
                        </div>
                    </div>
                </details>
            </section>
            <button
                onClick={async () => {
                    await clearConversations();
                    setConversations({});
                    setActiveId(null);

                    const kp = await generateKeyPair();
                    setKeyPair(kp);
                    const exported = await exportPublicKey(kp.publicKey);
                    setQrPublicKey(exported);
                }}
                className="ml-auto px-3 py-1 text-xs text-red-600 border border-red-600 rounded hover:bg-red-50"
            >
                Clear Conversations
            </button>
            {showScanner && (
                <div className="mb-4">
                    <h3 className="text-sm font-semibold mb-1 text-center">Scan QR</h3>
                    <video ref={qrVideoRef} className="border rounded w-60 mx-auto" />
                </div>
            )}

            <section className="flex flex-col gap-x-2 px-2 mb-4">
                <h3 className="text-lg font-semibold mb-2">Conversations</h3>
                <div className="flex gap-2 overflow-x-auto pb-2">
                    {Object.entries(conversations).map(([id, convo]) => (
                        <button key={id} onClick={() => setActiveId(id)} className={`px-4 py-2 text-sm rounded-full ${activeId === id ? 'bg-blue-500 text-white' : 'bg-gray-100 text-black'}`}>
                            {convo.name}
                        </button>
                    ))}

                </div>
            </section>
            {activeId && Object.entries(conversations).length > 0 ? <details className="w-full">
                <summary className="text-lg font-semibold cursor-pointer mb-2">Your Public Key</summary>
                <div className="flex flex-col items-center">
                    {(pendingConversationId || activeId) && qrPublicKey && (
                        <QRCode
                            value={JSON.stringify({
                                publicKey: qrPublicKey,
                                conversationId: pendingConversationId || activeId
                            })}
                            size={200}
                            className="bg-white p-2 border"
                        />
                    )}
                </div>
            </details> : null}
            {activeId && (
                <div className="text-sm text-gray-500 mb-2">
                    {(ratchets[activeId] && conversations[activeId]?.myPublicKey && conversations[activeId]?.theirPublicKey)
                        ? 'Ratchet key exchange complete'
                        : 'Waiting for public key exchange...'}
                </div>
            )}
            {activeId && (
                <div className="flex flex-col flex-1 px-2">
                    {ratchets[activeId] && (
                        <details className="text-xs text-gray-600 mt-2 break-all">
                            <summary className="font-semibold cursor-pointer">Ratchet Info</summary>
                            <div><strong>Send Chain:</strong> {btoa(String.fromCharCode(...ratchets[activeId].sendChain))}</div>
                            <div><strong>Recv Chain:</strong> {btoa(String.fromCharCode(...ratchets[activeId].recvChain))}</div>
                        </details>
                    )}
                    <div className="mt-2 text-xs text-gray-600 w-full break-all">
                        <div><strong>Your Public Key:</strong></div>
                        <div className="mb-2">{conversations[activeId]?.myPublicKey || '—'}</div>
                        <div><strong>Their Public Key:</strong></div>
                        <div>{conversations[activeId]?.theirPublicKey || '—'}</div>
                    </div>
                    <div className="bg-gray-100 p-3 rounded flex-1 overflow-y-auto mb-2">
                        {(conversations[activeId].history || []).map((entry, index) => (
                            <div key={index} className={`my-1 px-3 py-2 rounded-lg text-sm max-w-[75%] ${entry.type === 'sent' ? 'ml-auto bg-blue-500 text-white' : 'mr-auto bg-white border'}`}>
                                {entry.message}
                            </div>
                        ))}
                    </div>

                    <div className="mt-auto mb-4">
                        <textarea className="w-full border rounded p-2 text-sm" rows={2} placeholder="Type your message..." value={message} onChange={(e) => setMessage(e.target.value)} />
                        <div className="flex items-center justify-between mt-2">
                            <label className="flex items-center gap-2 cursor-pointer">
                                <ImageIcon className="w-4 h-4" />
                                <input type="file" accept="image/png" disabled={message.length == 0} className="hidden" onChange={handleEncode} />
                                Encode
                            </label>
                            <label className="flex items-center gap-2 cursor-pointer">
                                <UploadIcon className="w-4 h-4" />
                                <input type="file" accept="image/png" className="hidden" onChange={(e) => {
                                    console.log("Decode input triggered");
                                    handleDecode(e);
                                }} />
                                Decode
                            </label>
                            <button onClick={() => setMessage('')} className="text-xs text-gray-400">Clear</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}