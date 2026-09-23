import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'node:path';
import Database from 'better-sqlite3';
import { initializeSchema } from '../db/schema';
import { seedDatabase } from '../db/seed';
import { registerMainProcessServices } from './bootstrap';
import { ScaleService } from './hardware/scaleService';
import { registerScaleRendererEvents } from './hardware/scaleService';

let database: Database.Database | null = null;
let scaleService: ScaleService | null = null;

function createWindow(): BrowserWindow {
    const window = new BrowserWindow({
        width: 1440,
        height: 960,
        minWidth: 1024,
        minHeight: 720,
        webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: false,
            preload: path.join(__dirname, '../preload.js'),
        },
    });

    void window.loadFile(path.join(__dirname, '../../renderer/index.html'));
    return window;
}

app.whenReady().then(() => {
    database = new Database(path.join(app.getPath('userData'), 'bakealley.sqlite'));
    initializeSchema(database);
    seedDatabase(database);

    scaleService = new ScaleService({
        path: process.env.BAKE_ALLEY_SCALE_PORT ?? 'COM1',
    });
    registerMainProcessServices({ ipcMain, database, scaleService });

    const window = createWindow();
    registerScaleRendererEvents(scaleService, () => [window.webContents]);

    if (process.env.BAKE_ALLEY_SCALE_PORT) {
        void scaleService.connect().catch(() => undefined);
    }

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('will-quit', () => {
    database?.close();
});