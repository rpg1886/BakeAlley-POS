import Database from 'better-sqlite3';

export interface SyncQueueRecord {
    queue_id: string;
    entity_type: string;
    entity_id: string;
    operation: 'create' | 'update' | 'delete';
    payload: string;
    status: 'PENDING' | 'PROCESSING' | 'SYNCED' | 'FAILED';
    retry_count: number;
    next_attempt_at: string | null;
    last_error: string | null;
    created_at: string;
    updated_at: string;
}

export interface SyncWorkerOptions {
    database: Database.Database;
    endpoint: string;
    fetch?: typeof fetch;
    batchSize?: number;
    pollIntervalMs?: number;
    baseRetryDelayMs?: number;
    maxRetryDelayMs?: number;
    networkStatus?: () => Promise<boolean>;
    networkPollIntervalMs?: number;
    now?: () => Date;
    sleep?: (durationMs: number) => Promise<void>;
}

interface SyncBatchResponse {
    syncedQueueIds?: string[];
}

const DEFAULT_BATCH_SIZE = 50;
const DEFAULT_POLL_INTERVAL_MS = 5_000;
const DEFAULT_BASE_RETRY_DELAY_MS = 1_000;
const DEFAULT_MAX_RETRY_DELAY_MS = 300_000;
const DEFAULT_NETWORK_POLL_INTERVAL_MS = 10_000;

export class PosSyncWorker {
    private readonly database: Database.Database;
    private readonly endpoint: string;
    private readonly request: typeof fetch;
    private readonly batchSize: number;
    private readonly pollIntervalMs: number;
    private readonly baseRetryDelayMs: number;
    private readonly maxRetryDelayMs: number;
    private readonly networkStatus: (() => Promise<boolean>) | null;
    private readonly networkPollIntervalMs: number;
    private readonly now: () => Date;
    private readonly sleep: (durationMs: number) => Promise<void>;
    private running = false;
    private pollPromise: Promise<void> | null = null;
    private networkAvailable = true;
    private lastNetworkCheckAt = 0;

    public constructor(options: SyncWorkerOptions) {
        this.database = options.database;
        this.endpoint = options.endpoint;
        this.request = options.fetch ?? fetch;
        this.batchSize = Math.min(Math.max(options.batchSize ?? DEFAULT_BATCH_SIZE, 1), DEFAULT_BATCH_SIZE);
        this.pollIntervalMs = Math.max(options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS, 0);
        this.baseRetryDelayMs = Math.max(options.baseRetryDelayMs ?? DEFAULT_BASE_RETRY_DELAY_MS, 1);
        this.maxRetryDelayMs = Math.max(options.maxRetryDelayMs ?? DEFAULT_MAX_RETRY_DELAY_MS, this.baseRetryDelayMs);
        this.networkStatus = options.networkStatus ?? null;
        this.networkPollIntervalMs = Math.max(options.networkPollIntervalMs ?? DEFAULT_NETWORK_POLL_INTERVAL_MS, 0);
        this.now = options.now ?? (() => new Date());
        this.sleep = options.sleep ?? ((durationMs) => new Promise((resolve) => setTimeout(resolve, durationMs)));
    }

    public start(): void {
        if (this.running) {
            return;
        }

        this.running = true;
        this.pollPromise = this.runLoop();
    }

    public async stop(): Promise<void> {
        this.running = false;
        await this.pollPromise;
        this.pollPromise = null;
    }

    public async syncOnce(): Promise<number> {
        if (!(await this.isNetworkAvailable())) {
            return 0;
        }

        const records = this.claimBatch();
        if (records.length === 0) {
            return 0;
        }

        try {
            const response = await this.request(this.endpoint, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ items: records }),
            });

            if (!response.ok) {
                throw new Error(`Sync API returned HTTP ${response.status}`);
            }

            const responseBody = await this.readResponse(response);
            const syncedQueueIds = responseBody.syncedQueueIds ?? records.map((record) => record.queue_id);
            const syncedCount = this.markSynced(records, syncedQueueIds);
            const syncedIds = new Set(syncedQueueIds);
            const unacknowledged = records.filter((record) => !syncedIds.has(record.queue_id));
            if (unacknowledged.length > 0) {
                this.scheduleRetry(unacknowledged, 'Sync API did not acknowledge this queue item');
            }
            return syncedCount;
        } catch (error) {
            this.scheduleRetry(records, this.errorMessage(error));
            return 0;
        }
    }

    private async runLoop(): Promise<void> {
        while (this.running) {
            await this.isNetworkAvailable(true);
            await this.syncOnce();
            if (this.running) {
                await this.sleep(this.pollIntervalMs);
            }
        }
    }

    private async isNetworkAvailable(force = false): Promise<boolean> {
        if (!this.networkStatus) {
            return true;
        }

        const currentTime = Date.now();
        if (!force && currentTime - this.lastNetworkCheckAt < this.networkPollIntervalMs) {
            return this.networkAvailable;
        }

        this.lastNetworkCheckAt = currentTime;
        try {
            this.networkAvailable = await this.networkStatus();
        } catch {
            this.networkAvailable = false;
        }
        return this.networkAvailable;
    }

    private claimBatch(): SyncQueueRecord[] {
        const now = this.now().toISOString();
        const claim = this.database.transaction(() => {
            this.database.prepare(`
                UPDATE sync_queue
                SET status = 'PENDING', updated_at = @now
                WHERE status = 'FAILED'
                  AND (next_attempt_at IS NULL OR next_attempt_at <= @now)
            `).run({ now });

            const records = this.database.prepare(`
                SELECT *
                FROM sync_queue
                WHERE status = 'PENDING'
                  AND (next_attempt_at IS NULL OR next_attempt_at <= @now)
                ORDER BY created_at ASC, queue_id ASC
                LIMIT @batchSize
            `).all({ now, batchSize: this.batchSize }) as SyncQueueRecord[];

            if (records.length > 0) {
                const queueIds = records.map((record) => record.queue_id);
                const placeholders = queueIds.map(() => '?').join(', ');
                this.database.prepare(`
                    UPDATE sync_queue
                    SET status = 'PROCESSING', updated_at = ?
                    WHERE queue_id IN (${placeholders})
                `).run(now, ...queueIds);
            }

            return records.map((record) => ({ ...record, status: 'PROCESSING' as const }));
        });

        return claim();
    }

    private markSynced(records: SyncQueueRecord[], syncedQueueIds: string[]): number {
        const syncedIds = new Set(syncedQueueIds);
        const now = this.now().toISOString();
        const mark = this.database.transaction(() => {
            const update = this.database.prepare(`
                UPDATE sync_queue
                SET status = 'SYNCED', next_attempt_at = NULL, last_error = NULL, updated_at = ?
                WHERE queue_id = ? AND status = 'PROCESSING'
            `);
            let count = 0;
            for (const record of records) {
                if (syncedIds.has(record.queue_id)) {
                    count += update.run(now, record.queue_id).changes;
                }
            }
            return count;
        });

        return mark();
    }

    private scheduleRetry(records: SyncQueueRecord[], message: string): void {
        const now = this.now();
        const updatedAt = now.toISOString();
        const update = this.database.prepare(`
            UPDATE sync_queue
            SET status = 'FAILED', retry_count = retry_count + 1,
                next_attempt_at = ?, last_error = ?, updated_at = ?
            WHERE queue_id = ? AND status = 'PROCESSING'
        `);
        const retry = this.database.transaction(() => {
            for (const record of records) {
                const delay = Math.min(
                    this.baseRetryDelayMs * (2 ** record.retry_count),
                    this.maxRetryDelayMs,
                );
                update.run(new Date(now.getTime() + delay).toISOString(), message, updatedAt, record.queue_id);
            }
        });

        retry();
    }

    private async readResponse(response: Response): Promise<SyncBatchResponse> {
        const text = await response.text();
        if (text.length === 0) {
            return {};
        }

        const parsed: unknown = JSON.parse(text);
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
            throw new Error('Sync API returned an invalid response');
        }

        const body = parsed as { syncedQueueIds?: unknown };
        if (body.syncedQueueIds === undefined) {
            return {};
        }
        if (!Array.isArray(body.syncedQueueIds) || !body.syncedQueueIds.every((id): id is string => typeof id === 'string')) {
            throw new Error('Sync API returned invalid queue IDs');
        }

        return { syncedQueueIds: body.syncedQueueIds };
    }

    private errorMessage(error: unknown): string {
        return error instanceof Error ? error.message : 'Unknown sync failure';
    }
}