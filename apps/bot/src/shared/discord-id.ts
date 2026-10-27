/**
 * A Discord snowflake is the only id the gateway, REST API, role grants and
 * channel overwrites understand. Imported signups that have not been linked to a
 * member yet run through the same participant row with a `imp:<importId>` id, so
 * every Discord-touching path asks this first instead of sending a fake id.
 */
export function isDiscordId(id: string): boolean {
  return /^[0-9]{17,20}$/.test(id);
}
