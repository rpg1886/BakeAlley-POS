import type { IpcMain } from 'electron';
import type { EmployeeService } from './employeeService';
import { employeeIpcChannels } from '../../shared/ipcChannels';

export function registerEmployeeIpcHandlers(ipcMain: Pick<IpcMain, 'handle' | 'removeHandler'>, service: EmployeeService): void {
    for (const channel of Object.values(employeeIpcChannels)) ipcMain.removeHandler(channel);
    ipcMain.handle(employeeIpcChannels.list, (_event, token: unknown) => {
        if (typeof token !== 'string') throw new Error('Authentication token is required');
        return service.listEmployees(token);
    });
    ipcMain.handle(employeeIpcChannels.clockIn, (_event, token: unknown) => {
        if (typeof token !== 'string') throw new Error('Authentication token is required');
        return service.clockIn(token);
    });
    ipcMain.handle(employeeIpcChannels.clockOut, (_event, token: unknown) => {
        if (typeof token !== 'string') throw new Error('Authentication token is required');
        return service.clockOut(token);
    });
    ipcMain.handle(employeeIpcChannels.recordSale, (_event, token: unknown, orderId: unknown) => {
        if (typeof token !== 'string' || typeof orderId !== 'string') throw new Error('Invalid employee sale request');
        return service.recordSale(token, orderId);
    });
    ipcMain.handle(employeeIpcChannels.shifts, (_event, token: unknown, date: unknown) => {
        if (typeof token !== 'string' || typeof date !== 'string') throw new Error('Invalid shift report request');
        return service.listShifts(token, date);
    });
    ipcMain.handle(employeeIpcChannels.create, (_event, token: unknown, input: unknown) => {
        if (typeof token !== 'string' || typeof input !== 'object' || input === null) throw new Error('Invalid employee request');
        return service.createEmployee(token, input as never);
    });
}
