export interface PendingCloudEvent {
    eventId: string;
    entityType: string;
    entityId: string;
    operation: 'create' | 'update' | 'delete';
    payload: unknown;
    status: 'pending' | 'processing' | 'failed';
    attempts: number;
    nextAttemptAt: string | null;
    lastError: string | null;
    createdAt: string;
}

const DATABASE_NAME = 'bakealley-cloud-pos';
const DATABASE_VERSION = 1;
const OUTBOX_STORE = 'sync_queue';

export class BrowserOfflineStore {
    public async enqueue(event: PendingCloudEvent): Promise<void> {
        const database = await this.open();
        await new Promise<void>((resolve, reject) => {
            const transaction = database.transaction(OUTBOX_STORE, 'readwrite');
            transaction.objectStore(OUTBOX_STORE).put(event);
            transaction.oncomplete = () => resolve();
            transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB write failed'));
        });
        database.close();
    }

    public async pending(limit = 50): Promise<PendingCloudEvent[]> {
        const database = await this.open();
        const records = await new Promise<PendingCloudEvent[]>((resolve, reject) => {
            const request = database.transaction(OUTBOX_STORE, 'readonly').objectStore(OUTBOX_STORE).getAll();
            request.onsuccess = () => resolve((request.result as PendingCloudEvent[]).filter((event) => event.status !== 'processing').slice(0, limit));
            request.onerror = () => reject(request.error ?? new Error('IndexedDB read failed'));
        });
        database.close();
        return records;
    }

    private open(): Promise<IDBDatabase> {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
            request.onupgradeneeded = () => request.result.createObjectStore(OUTBOX_STORE, { keyPath: 'eventId' });
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'));
        });
    }
}
