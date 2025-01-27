/**
 * Calendar Module Entry Point
 * 
 * This module provides Google Calendar integration following the same singleton
 * pattern as the Gmail module. It handles:
 * - Module initialization with OAuth setup
 * - Calendar service instance management
 * - Type and error exports
 * 
 * Usage:
 * ```typescript
 * // Initialize the module
 * await initializeCalendarModule();
 * 
 * // Get service instance
 * const calendarService = getCalendarService();
 * 
 * // Use calendar operations
 * const events = await calendarService.getEvents({
 *   email: 'user@example.com',
 *   maxResults: 10
 * });
 * ```
 */

import { CalendarService } from './service.js';
import {
  GetEventsParams,
  CreateEventParams,
  EventResponse,
  CreateEventResponse,
  CalendarError,
  CalendarModuleConfig,
  DEFAULT_CALENDAR_SCOPES
} from './types.js';

// Create singleton instance
let calendarService: CalendarService | null = null;

/**
 * Initialize the Calendar module
 * This must be called before using any calendar operations
 * 
 * @param config - Optional configuration including OAuth scope overrides
 * @returns Initialized CalendarService instance
 * 
 * Note: This function ensures only one instance of the service exists,
 * following the singleton pattern for consistent state management.
 */
export async function initializeCalendarModule(config?: CalendarModuleConfig): Promise<CalendarService> {
  if (!calendarService) {
    calendarService = new CalendarService(config);
    await calendarService.initialize();
  }
  return calendarService;
}

/**
 * Get the initialized Calendar service instance
 * 
 * @returns CalendarService instance
 * @throws CalendarError if the module hasn't been initialized
 * 
 * Note: Always call initializeCalendarModule before using this function
 */
export function getCalendarService(): CalendarService {
  if (!calendarService) {
    throw new CalendarError(
      'Calendar module not initialized',
      'MODULE_NOT_INITIALIZED',
      'Call initializeCalendarModule before using the Calendar service'
    );
  }
  return calendarService;
}

export {
  CalendarService,
  GetEventsParams,
  CreateEventParams,
  EventResponse,
  CreateEventResponse,
  CalendarError,
  CalendarModuleConfig,
  DEFAULT_CALENDAR_SCOPES
};
