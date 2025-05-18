const DB_NAME = 'StegoChatSecure';
const STORE_NAME = 'conversations';

const getDB = () =>
  new Promise((resolve, reject) => {
    const open = indexedDB.open(DB_NAME, 1);
    open.onupgradeneeded = () => open.result.createObjectStore(STORE_NAME, { keyPath: 'id' });
    open.onerror = () => reject(open.error);
    open.onsuccess = () => resolve(open.result);
  });

export const saveConversation = async (conv) => {
  const db = await getDB();
  const tx = db.transaction(STORE_NAME, 'readwrite');
  tx.objectStore(STORE_NAME).put(conv);
  await tx.complete;
};

export const loadConversations = async () => {
  const db = await getDB();
  const tx = db.transaction(STORE_NAME, 'readonly');
  const store = tx.objectStore(STORE_NAME);
  return new Promise((res) => {
    const data = [];
    const req = store.openCursor();
    req.onsuccess = () => {
      const cursor = req.result;
      if (cursor) {
        data.push(cursor.value);
        cursor.continue();
      } else {
        res(data);
      }
    };
  });
};

export async function clearConversations() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME);
        request.onsuccess = () => {
            const db = request.result;
            const tx = db.transaction(STORE_NAME, 'readwrite');
            const store = tx.objectStore(STORE_NAME);
            const clearRequest = store.clear();
            clearRequest.onsuccess = () => resolve();
            clearRequest.onerror = () => reject(clearRequest.error);
        };
        request.onerror = () => reject(request.error);
    });
}