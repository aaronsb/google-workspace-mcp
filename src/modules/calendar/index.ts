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

export async function initializeCalendarModule(config?: CalendarModuleConfig): Promise<CalendarService> {
  if (!calendarService) {
    calendarService = new CalendarService(config);
    await calendarService.initialize();
  }
  return calendarService;
}

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
