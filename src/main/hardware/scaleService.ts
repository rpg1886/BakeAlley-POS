import type { WebContents } from 'electron';
import {
    ScaleService,
    parseScaleLine,
    registerScaleIpcHandlers,
    scaleIpcChannels,
} from './scale';

export {
    ScaleService,
    parseScaleLine,
    registerScaleIpcHandlers,
    scaleIpcChannels,
} from './scale';
export type {
    ScaleConnectionState,
    ScaleReading,
    ScaleServiceOptions,
    ScaleStatus,
    ScaleUnit,
} from './scale';

export function registerScaleRendererEvents(
    service: ScaleService,
    getRenderers: () => readonly WebContents[],
): () => void {
    return service.onReading((reading) => {
        for (const renderer of getRenderers()) {
            if (!renderer.isDestroyed()) {
                renderer.send(scaleIpcChannels.reading, reading);
            }
        }
    });
}