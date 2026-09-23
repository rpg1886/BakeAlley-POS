import { SerialPort } from 'serialport';
import type { IpcMain } from 'electron';
import { scaleIpcChannels } from '../../shared/ipcChannels';

export { scaleIpcChannels } from '../../shared/ipcChannels';

export type ScaleUnit = 'g' | 'kg';

export interface ScaleReading {
    grams: number;
    value: number;
    unit: ScaleUnit;
    stable: boolean;
    raw: string;
    receivedAt: string;
}

export type ScaleConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface ScaleStatus {
    state: ScaleConnectionState;
    portPath: string;
    lastError: string | null;
    lastReading: ScaleReading | null;
}

export interface ScaleServiceOptions {
    path: string;
    baudRate?: number;
    reconnectDelayMs?: number;
    maxReconnectDelayMs?: number;
    now?: () => Date;
    createPort?: (options: { path: string; baudRate: number; autoOpen: false }) => ScalePort;
}

interface ScalePort {
    isOpen: boolean;
    on(event: 'open', listener: () => void): this;
    on(event: 'data', listener: (chunk: Buffer) => void): this;
    on(event: 'error', listener: (error: Error) => void): this;
    on(event: 'close', listener: () => void): this;
    open(callback?: (error?: Error | null) => void): void;
    close(callback?: (error?: Error | null) => void): void;
}

const WEIGHT_PATTERN = /([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s*(kg|kilograms?|g|grams?)\b/i;
const DEFAULT_BAUD_RATE = 9_600;
const DEFAULT_RECONNECT_DELAY_MS = 1_000;
const DEFAULT_MAX_RECONNECT_DELAY_MS = 30_000;

export function parseScaleLine(line: string, receivedAt = new Date()): ScaleReading | null {
    const raw = line.trim();
    const match = WEIGHT_PATTERN.exec(raw);
    if (!match) {
        return null;
    }

    const value = Number(match[1]);
    if (!Number.isFinite(value)) {
        return null;
    }

    const unit: ScaleUnit = match[2].toLowerCase().startsWith('kg')
        ? 'kg'
        : 'g';
    const grams = unit === 'kg' ? value * 1_000 : value;

    return {
        grams,
        value,
        unit,
        stable: /(?:^|[,\s])ST(?:$|[,\s])/i.test(raw),
        raw,
        receivedAt: receivedAt.toISOString(),
    };
}

export class ScaleService {
    private readonly path: string;
    private readonly baudRate: number;
    private readonly reconnectDelayMs: number;
    private readonly maxReconnectDelayMs: number;
    private readonly now: () => Date;
    private readonly createPort: (options: { path: string; baudRate: number; autoOpen: false }) => ScalePort;
    private port: ScalePort | null = null;
    private buffer = '';
    private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    private reconnectAttempt = 0;
    private started = false;
    private state: ScaleConnectionState = 'disconnected';
    private lastError: string | null = null;
    private lastReading: ScaleReading | null = null;
    private readonly readingListeners = new Set<(reading: ScaleReading) => void>();

    public constructor(options: ScaleServiceOptions) {
        this.path = options.path;
        this.baudRate = options.baudRate ?? DEFAULT_BAUD_RATE;
        this.reconnectDelayMs = Math.max(options.reconnectDelayMs ?? DEFAULT_RECONNECT_DELAY_MS, 1);
        this.maxReconnectDelayMs = Math.max(options.maxReconnectDelayMs ?? DEFAULT_MAX_RECONNECT_DELAY_MS, this.reconnectDelayMs);
        this.now = options.now ?? (() => new Date());
        this.createPort = options.createPort ?? ((portOptions) => new SerialPort(portOptions) as unknown as ScalePort);
    }

    public async connect(): Promise<ScaleStatus> {
        this.started = true;
        this.clearReconnectTimer();

        if (this.port?.isOpen) {
            return this.getStatus();
        }

        this.state = 'connecting';
        this.lastError = null;
        this.buffer = '';
        const port = this.createPort({ path: this.path, baudRate: this.baudRate, autoOpen: false });
        this.port = port;
        this.attachPortListeners(port);

        await new Promise<void>((resolve, reject) => {
            port.open((error) => {
                if (error) {
                    this.handlePortError(error);
                    reject(error);
                    return;
                }
                resolve();
            });
        });

        this.state = 'connected';
        this.reconnectAttempt = 0;
        return this.getStatus();
    }

    public async disconnect(): Promise<ScaleStatus> {
        this.started = false;
        this.clearReconnectTimer();
        this.reconnectAttempt = 0;

        const port = this.port;
        if (port && port.isOpen) {
            await new Promise<void>((resolve) => {
                port.close(() => resolve());
            });
        }

        this.port = null;
        this.state = 'disconnected';
        return this.getStatus();
    }

    public getReading(): ScaleReading | null {
        return this.lastReading;
    }

    public onReading(listener: (reading: ScaleReading) => void): () => void {
        this.readingListeners.add(listener);
        return () => this.readingListeners.delete(listener);
    }

    public getStatus(): ScaleStatus {
        return {
            state: this.state,
            portPath: this.path,
            lastError: this.lastError,
            lastReading: this.lastReading,
        };
    }

    private attachPortListeners(port: ScalePort): void {
        port.on('data', (chunk) => this.handleData(chunk));
        port.on('error', (error) => this.handlePortError(error));
        port.on('close', () => this.handlePortClose());
    }

    private handleData(chunk: Buffer): void {
        this.buffer += chunk.toString('ascii');
        const lines = this.buffer.split(/\r?\n/);
        this.buffer = lines.pop() ?? '';

        for (const line of lines) {
            const reading = parseScaleLine(line, this.now());
            if (reading) {
                this.lastReading = reading;
                for (const listener of this.readingListeners) {
                    listener(reading);
                }
            }
        }
    }

    private handlePortError(error: Error): void {
        this.lastError = error.message;
        this.state = 'error';
    }

    private handlePortClose(): void {
        this.port = null;
        this.state = 'disconnected';
        if (this.started) {
            this.scheduleReconnect();
        }
    }

    private scheduleReconnect(): void {
        if (this.reconnectTimer) {
            return;
        }

        const delay = Math.min(
            this.reconnectDelayMs * (2 ** this.reconnectAttempt),
            this.maxReconnectDelayMs,
        );
        this.reconnectAttempt += 1;
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            void this.connect().catch(() => this.scheduleReconnect());
        }, delay);
    }

    private clearReconnectTimer(): void {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
    }
}

export function registerScaleIpcHandlers(ipcMain: Pick<IpcMain, 'handle' | 'removeHandler'>, service: ScaleService): void {
    ipcMain.removeHandler(scaleIpcChannels.read);
    ipcMain.removeHandler(scaleIpcChannels.status);
    ipcMain.removeHandler(scaleIpcChannels.connect);
    ipcMain.removeHandler(scaleIpcChannels.disconnect);

    ipcMain.handle(scaleIpcChannels.read, () => service.getReading());
    ipcMain.handle(scaleIpcChannels.status, () => service.getStatus());
    ipcMain.handle(scaleIpcChannels.connect, () => service.connect());
    ipcMain.handle(scaleIpcChannels.disconnect, () => service.disconnect());
}