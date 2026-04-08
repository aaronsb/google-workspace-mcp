/**
 * Patch registry — collects all per-service patches.
 * Import this to get the complete patch map for the generator.
 */

import { gmailPatch } from '../services/gmail/patch.js';
import { calendarPatch } from '../services/calendar/patch.js';
import { drivePatch } from '../services/drive/patch.js';
import { docsPatch } from '../services/docs/patch.js';
import { meetPatch } from '../services/meet/patch.js';
import type { ServicePatch } from './types.js';

export const patches: Record<string, ServicePatch> = {
  gmail: gmailPatch,
  calendar: calendarPatch,
  drive: drivePatch,
  docs: docsPatch,
  meet: meetPatch,
};
