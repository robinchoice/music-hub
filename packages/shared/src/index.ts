import type { Band } from './band.js';

export * from './band.js';
export * from './i18n.js';
export * from './constants/index.js';
export * from './validation/index.js';

// Name of the app wherever a text names it
export const APP_NAME = 'Music Hub';

// Section of the Pleasance family colour band for Music Hub, see the design guide of the starter
export const APP_BAND: Band = { from: 1.35, to: 2.2 };

export * from './login-messages.js';
export * from './terms.js';
export * from './upload-plan.js';
export * from './import-plan.js';
export * from './measurements.js';
export * from './versions.js';
export * from './song-key.js';
