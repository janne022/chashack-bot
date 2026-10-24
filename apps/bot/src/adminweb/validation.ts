/** Baseline runtime shape checks before handlers/domain functions consume JSON.
 * Endpoint-specific ownership, enums and business rules remain authoritative. */
export function mutationBodyError(raw: unknown): string | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'object' || Array.isArray(raw)) return 'body';
  const body = raw as Record<string, unknown>;
  const strings = new Set(['name', 'description', 'title', 'message', 'reason', 'action', 'decision', 'kind', 'revision', 'eventId', 'teamId', 'userId', 'ownerId', 'targetId', 'participantId', 'guildId', 'templateId', 'formTemplateId', 'channelId', 'panelChannelId', 'announcementChannelId', 'scheduleChannelId', 'categoryId', 'teamCategoryId', 'defaultAnnouncementChannelId', 'defaultPanelChannelId', 'defaultCategoryId', 'defaultScheduleChannelId', 'defaultFormTemplateId', 'discordUsername', 'linkDiscordUserId', 'colorId', 'json', 'formJson', 'csv', 'saveTemplateName', 'assignmentStrategy']);
  const dates = new Set(['startsAt', 'endsAt', 'signupStartsAt', 'signupEndsAt', 'matchAt']);
  const numbers = new Set(['days', 'durationHours', 'cleanupDelayHours', 'defaultCleanupDelayHours', 'formVersion']);
  for (const [key, value] of Object.entries(body)) {
    if (['__proto__', 'constructor', 'prototype'].includes(key)) return key;
    if (strings.has(key) && value !== null && (typeof value !== 'string' || value.length > (['csv', 'json', 'formJson'].includes(key) ? 900_000 : 10_000))) return key;
    if (dates.has(key) && value !== null && (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > 8_640_000_000_000_000)) return key;
    if (numbers.has(key) && value !== null && (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1_000_000)) return key;
    if (['launch', 'saveAsTemplate', 'dm'].includes(key) && typeof value !== 'boolean') return key;
    if (['schedule', 'announcements', 'assignments', 'rows', 'modRoleIds'].includes(key) && value !== null && (!Array.isArray(value) || value.length > (key === 'rows' ? 1000 : 100))) return key;
  }
  return null;
}
