/** Server reasons may include a diagnostic suffix; expose only recognized categories. */
export function announcementFailureKey(reason: string): string {
  const code = reason.split(/[\s:]/, 1)[0]
  switch (code) {
    case 'no_channel_configured': return 'events.announce_no_channel'
    case 'guild_invalid': return 'events.announce_bad_server'
    case 'channel_invalid': return 'events.announce_bad_channel'
    case 'channel_not_found': return 'events.announce_channel_missing'
    case 'not_text_based': return 'events.announce_not_text'
    case 'missing_access': return 'events.announce_no_access'
    default: return 'events.announce_unknown'
  }
}
