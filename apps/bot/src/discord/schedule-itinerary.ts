/**
 * Schedule itinerary: posts the whole itinerary with Discord timestamps (<t:unix:F> / <t:unix:R>)
 * into a dedicated schedule channel. Message is edited in place (via meta) so the
 * channel always shows one up-to-date itinerary, not spam.
 */
import { EmbedBuilder, type Client, type TextChannel } from 'discord.js'
import type { Db } from '../shared/db.js'
import { t } from '../shared/i18n.js'
import type { HackathonEvent } from '../features/events/data.js'
import { botLocale } from './provision.js'

const key = (eventId: string) => `schedule_itinerary:${eventId}`

function getItineraryRef(db: Db, eventId: string): { channelId: string; messageId: string } | null {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key(eventId)) as { value: string } | undefined
  if (!row) return null
  try {
    const p = JSON.parse(row.value) as { channelId: string; messageId: string }
    return p.channelId && p.messageId ? p : null
  } catch { return null }
}

function setItineraryRef(db: Db, eventId: string, ref: { channelId: string; messageId: string }) {
  db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key(eventId), JSON.stringify(ref))
}

export function buildScheduleItineraryEmbed(event: HackathonEvent): EmbedBuilder {
  const locale = botLocale()
  const title = `📅 ${event.name} — Itinerary`
  const lines: string[] = []
  if (event.description) lines.push(event.description, '')
  if (event.startsAt !== null) lines.push(`**Starts:** <t:${Math.floor(event.startsAt/1000)}:F> (<t:${Math.floor(event.startsAt/1000)}:R>)`)
  if (event.endsAt !== null) lines.push(`**Ends:** <t:${Math.floor(event.endsAt/1000)}:F>`)
  lines.push('')

  if (!event.schedule || event.schedule.filter(s=>s.id!=='__start__' && s.id!=='__end__').length === 0) {
    lines.push('_No schedule yet — the organizers will add dinner, breaks, voting etc._')
  } else {
    lines.push(`**Schedule — ${event.schedule.filter(s=>s.id!=='__start__' && s.id!=='__end__').length} blocks**`)
    for (const item of [...event.schedule].filter(s=>s.id!=='__start__' && s.id!=='__end__').sort((a,b)=>a.time-b.time)) {
      const timeFull = `<t:${Math.floor(item.time/1000)}:F>`
      const timeRel = `<t:${Math.floor(item.time/1000)}:R>`
      const kindEmoji: Record<string,string> = { food: '🍽️', break: '☕', voting: '🗳️', prize: '🏆', talk: '🎤', custom: '📌' }
      const emoji = kindEmoji[item.kind ?? 'custom'] ?? '📌'
      const desc = item.description ? ` — ${item.description}` : ''
      // Also list per-block actions if any
      const actions = item.actions?.length ? `  ↳ ${item.actions.map(a=> `**${a.title}**`).join(' · ')}` : ''
      lines.push(`${emoji} **${item.title}**${desc}`, `↳ ${timeFull} (${timeRel})${actions ? '\n' + actions : ''}`)
    }
  }
  lines.push('', `Updated: <t:${Math.floor(Date.now()/1000)}:R>`)
  return new EmbedBuilder()
    .setTitle(title)
    .setDescription(lines.join('\n'))
    .setColor(0x5865f2)
    .setFooter({ text: `Event ID ${event.id}` })
}

export async function postOrUpdateScheduleItinerary(
  db: Db,
  client: Client,
  event: HackathonEvent,
  overrideChannelId?: string | null,
): Promise<{ channelId: string; messageId: string; edited: boolean } | { error: string }> {
  const guild = await client.guilds.fetch(event.guildId).catch(()=>null)
  if (!guild) return { error: 'Guild not found' }
  // Resolve channel: override → event's schedule channel → guild default
  const { getGuildSettings } = await import('../features/teams/data.js')
  const gs = getGuildSettings(db, event.guildId)
  const channelId = overrideChannelId ?? event.scheduleChannelId ?? gs.defaultScheduleChannelId ?? null
  if (!channelId) return { error: 'No schedule channel set — pick one in the event or Config → Default schedule channel.' }
  const channel = await guild.channels.fetch(channelId).catch(()=>null)
  if (!channel || !channel.isTextBased()) return { error: 'Schedule channel is not a text channel or not found.' }

  const embed = buildScheduleItineraryEmbed(event)
  const existing = getItineraryRef(db, event.id)
  try {
    if (existing && existing.channelId === channelId) {
      const msg = await channel.messages.fetch(existing.messageId).catch(()=>null)
      if (msg && msg.author.id === client.user?.id) {
        await msg.edit({ embeds: [embed] })
        return { channelId, messageId: existing.messageId, edited: true }
      }
    }
    const sent = await (channel as TextChannel).send({ embeds: [embed] })
    setItineraryRef(db, event.id, { channelId, messageId: sent.id })
    return { channelId, messageId: sent.id, edited: false }
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) }
  }
}
