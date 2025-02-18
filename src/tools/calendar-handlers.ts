import { getAccountManager } from '../modules/accounts/index.js';
import { getCalendarService } from '../modules/calendar/index.js';
import { google } from 'googleapis';
import { McpToolResponse, CalendarEventParams } from './types.js';

export async function handleListWorkspaceCalendarEvents(args: CalendarEventParams): Promise<McpToolResponse> {
  const accountManager = getAccountManager();
  
  return await accountManager.withTokenRenewal(args.email, async () => {
    const events = await getCalendarService().getEvents(args);
    return {
      content: [{
        type: 'text',
        text: JSON.stringify(events, null, 2)
      }]
    };
  });
}

export async function handleGetWorkspaceCalendarEvent(args: { email: string, eventId: string }): Promise<McpToolResponse> {
  const accountManager = getAccountManager();
  
  return await accountManager.withTokenRenewal(args.email, async () => {
    const event = await getCalendarService().getEvent(args.email, args.eventId);
    return {
      content: [{
        type: 'text',
        text: JSON.stringify(event, null, 2)
      }]
    };
  });
}

export async function handleManageWorkspaceCalendarEvent(args: any): Promise<McpToolResponse> {
  const accountManager = getAccountManager();
  
  return await accountManager.withTokenRenewal(args.email, async () => {
    const result = await getCalendarService().manageEvent(args);
    return {
      content: [{
        type: 'text',
        text: JSON.stringify(result, null, 2)
      }]
    };
  });
}

export async function handleCreateWorkspaceCalendarEvent(args: any): Promise<McpToolResponse> {
  const accountManager = getAccountManager();
  
  return await accountManager.withTokenRenewal(args.email, async () => {
    const event = await getCalendarService().createEvent(args);
    return {
      content: [{
        type: 'text',
        text: JSON.stringify(event, null, 2)
      }]
    };
  });
}

export async function handleDeleteWorkspaceCalendarEvent(args: any): Promise<McpToolResponse> {
  const accountManager = getAccountManager();
  
  return await accountManager.withTokenRenewal(args.email, async () => {
    const authClient = await accountManager.getAuthClient();
    const calendar = google.calendar({ version: 'v3', auth: authClient });
    await calendar.events.delete({
      calendarId: 'primary',
      eventId: args.eventId,
      sendUpdates: args.sendUpdates || 'all'
    });
    
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          status: 'success',
          message: `Successfully deleted event ${args.eventId}`
        }, null, 2)
      }]
    };
  });
}
