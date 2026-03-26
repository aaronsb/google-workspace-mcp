/**
 * Adapter registry for scratchpad send and import operations.
 */

// Send adapters
export { sendEmail } from './send-email.js';
export { sendEmailDraft } from './send-email-draft.js';
export { sendDocCreate, sendDocWrite } from './send-doc.js';
export { sendWorkspace } from './send-workspace.js';

// Import adapters
export { importEmail } from './import-email.js';
export { importDoc } from './import-doc.js';
export { importSheet } from './import-sheet.js';
export { importDriveFile } from './import-drive.js';
