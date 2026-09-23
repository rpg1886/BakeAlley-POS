import type { IpcMain } from 'electron';
import type { AuthService } from './authService';
import { authIpcChannels } from '../../shared/ipcChannels';

export function registerAuthIpcHandlers(ipcMain: Pick<IpcMain, 'handle' | 'removeHandler'>, service: AuthService): void {
    ipcMain.removeHandler(authIpcChannels.login);
    ipcMain.removeHandler(authIpcChannels.logout);
    ipcMain.handle(authIpcChannels.login, (_event, username: unknown, password: unknown) => {
        if (typeof username !== 'string' || typeof password !== 'string') {
            throw new Error('Username and password are required');
        }
        return service.login(username, password);
    });
    ipcMain.handle(authIpcChannels.logout, (_event, token: unknown) => {
        if (typeof token !== 'string') {
            throw new Error('Authentication token is required');
        }
        service.logout(token);
    });
}