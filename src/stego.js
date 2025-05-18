export const encodeMessageInImage = async (imageFile, binaryData) => {
    const reader = new FileReader();

    return new Promise((resolve, reject) => {
        reader.onload = () => {
            const img = new Image();
            img.onload = () => {
                requestAnimationFrame(() => {
                    const canvas = document.createElement('canvas');
                    canvas.width = img.width;
                    canvas.height = img.height;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0);
                    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                    const data = imgData.data;
                    console.log("Image size:", canvas.width, "x", canvas.height);
                    console.log("Available bits:", (canvas.width * canvas.height));
                    const padding = Array(64).fill(0).map(() => Math.round(Math.random())).join('');
                    const marker = '1010101010101010';
                    const binary = binaryData + marker + padding;
                    if (binary.length > data.length / 4) {
                        console.warn("Image too small. Binary length:", binary.length, "Image capacity:", data.length / 4);
                        reject(new Error("Image too small"));
                        return;
                    }
                    let channel = 0;
                    for (let i = 0; i < binary.length && i * 4 < data.length; i++) {
                        data[i * 4 + channel] = (data[i * 4 + channel] & ~1) | parseInt(binary[i], 10);
                    }

                    ctx.putImageData(imgData, 0, 0);
                    canvas.toBlob(blob => resolve(URL.createObjectURL(blob)), 'image/png');
                })
            };
            img.src = reader.result;
        };
        reader.onerror = reject;
        reader.readAsDataURL(imageFile);
    });
};

export const decodeMessageFromImage = async (imageFile) => {
    const reader = new FileReader();
    return new Promise((resolve, reject) => {
        reader.onload = () => {
            const img = new Image();
            img.onload = () => {
                requestAnimationFrame(() => {
                    const canvas = document.createElement('canvas');
                    canvas.width = img.width;
                    canvas.height = img.height;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0);

                    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                    const data = imgData.data;
                    console.log("Image size:", canvas.width, "x", canvas.height);
                    console.log("Available bits:", (canvas.width * canvas.height));
                    let bits = '';
                    for (let i = 0; i < data.length; i += 4) {
                        bits += (data[i] & 1).toString();
                        if (bits.length > 65536) break;
                    }
                    if (!bits.includes('1010101010101010')) {
                        console.warn('No marker found — likely corrupted image');
                        alert("Image corrupted")
                        return resolve(new Uint8Array([]));
                    }
                    console.log("Total bits extracted from image:", bits.length);

                    if (bits.length < 16) {
                        console.warn("Insufficient bits to extract length");
                        return resolve(new Uint8Array([]));
                    }

                    const lenBits = bits.slice(0, 16);
                    const payloadLength = parseInt(lenBits, 2);
                    const totalBits = 16 + payloadLength * 8;

                    if (bits.length < totalBits) {
                        console.warn("Bits too short for expected payload length:", payloadLength);
                        return resolve(new Uint8Array([]));
                    }

                    const payloadBits = bits.slice(16, totalBits);
                    const bitsArray = payloadBits.match(/.{8}/g);

                    if (!bitsArray) {
                        console.warn("Bit chunks couldn't form bytes");
                        return resolve(new Uint8Array([]));
                    }

                    const byteArray = new Uint8Array(bitsArray.map(b => parseInt(b, 2)));
                    resolve(byteArray);
                })
            };

            img.src = reader.result;
        };

        reader.onerror = reject;
        reader.readAsDataURL(imageFile);
    });
};
