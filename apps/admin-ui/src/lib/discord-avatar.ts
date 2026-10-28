export function discordAvatarUrl(user: { id: string; avatar: string | null }): string | null {
  if (!/^\d{17,20}$/.test(user.id) || !user.avatar || !/^(?:a_)?[a-f0-9]{32}$/i.test(user.avatar)) return null
  return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=64`
}
