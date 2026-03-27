/**
 * Adapter registry for scratchpad send and import operations.
 */

// Send adapters
export { sendEmail } from './send-email.js';
export { sendEmailDraft } from './send-email-draft.js';
export { sendDocCreate, sendDocWrite } from './send-doc.js';
export { sendWorkspace } from './send-workspace.js';
export { sendSheetWrite } from './send-sheet.js';
export { sendCalendarEvent } from './send-calendar.js';
export { sendTaskCreate } from './send-task.js';

// Import adapters
export { importEmail } from './import-email.js';
export { importDoc } from './import-doc.js';
export { importSheet } from './import-sheet.js';
export { importDriveFile } from './import-drive.js';
export { importMeet } from './import-meet.js';
