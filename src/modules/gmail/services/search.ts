import { SearchCriteria } from '../types.js';

export class SearchService {
  /**
   * Builds a Gmail search query string from SearchCriteria
   */
  buildSearchQuery(criteria: SearchCriteria = {}): string {
    const queryParts: string[] = [];

    // Handle from (support multiple senders)
    if (criteria.from) {
      const fromAddresses = Array.isArray(criteria.from) ? criteria.from : [criteria.from];
      if (fromAddresses.length === 1) {
        queryParts.push(`from:${fromAddresses[0]}`);
      } else {
        queryParts.push(`{${fromAddresses.map(f => `from:${f}`).join(' OR ')}}`);
      }
    }

    // Handle to (support multiple recipients)
    if (criteria.to) {
      const toAddresses = Array.isArray(criteria.to) ? criteria.to : [criteria.to];
      if (toAddresses.length === 1) {
        queryParts.push(`to:${toAddresses[0]}`);
      } else {
        queryParts.push(`{${toAddresses.map(t => `to:${t}`).join(' OR ')}}`);
      }
    }

    // Handle subject (escape special characters and quotes)
    if (criteria.subject) {
      const escapedSubject = criteria.subject.replace(/["\\]/g, '\\$&');
      queryParts.push(`subject:"${escapedSubject}"`);
    }

    // Handle content (escape special characters and quotes)
    if (criteria.content) {
      const escapedContent = criteria.content.replace(/["\\]/g, '\\$&');
      queryParts.push(`"${escapedContent}"`);
    }

    // Handle date range (use Gmail's date format: YYYY/MM/DD)
    if (criteria.after) {
      const afterDate = new Date(criteria.after);
      const afterStr = `${afterDate.getFullYear()}/${(afterDate.getMonth() + 1).toString().padStart(2, '0')}/${afterDate.getDate().toString().padStart(2, '0')}`;
      queryParts.push(`after:${afterStr}`);
    }
    if (criteria.before) {
      const beforeDate = new Date(criteria.before);
      const beforeStr = `${beforeDate.getFullYear()}/${(beforeDate.getMonth() + 1).toString().padStart(2, '0')}/${beforeDate.getDate().toString().padStart(2, '0')}`;
      queryParts.push(`before:${beforeStr}`);
    }

    // Handle attachments
    if (criteria.hasAttachment) {
      queryParts.push('has:attachment');
    }

    // Handle labels (no need to join with spaces, Gmail supports multiple label: operators)
    if (criteria.labels && criteria.labels.length > 0) {
      criteria.labels.forEach(label => {
        queryParts.push(`label:${label}`);
      });
    }

    // Handle excluded labels
    if (criteria.excludeLabels && criteria.excludeLabels.length > 0) {
      criteria.excludeLabels.forEach(label => {
        queryParts.push(`-label:${label}`);
      });
    }

    // Handle spam/trash inclusion
    if (criteria.includeSpam) {
      queryParts.push('in:anywhere');
    }

    // Handle read/unread status
    if (criteria.isUnread !== undefined) {
      queryParts.push(criteria.isUnread ? 'is:unread' : 'is:read');
    }

    return queryParts.join(' ');
  }
}
