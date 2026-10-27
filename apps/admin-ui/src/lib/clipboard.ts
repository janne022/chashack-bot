/**
 * Copy text to the clipboard.
 *
 * `navigator.clipboard` only exists on a secure context. The console is regularly
 * served over plain HTTP on a LAN address or through a tunnel, where the API is
 * `undefined` and the old one-line handlers threw without any feedback. The
 * `textarea` fallback works everywhere, so a copy button always does something.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch { /* fall through to the legacy path */ }
  try {
    const area = document.createElement('textarea')
    area.value = text
    area.setAttribute('readonly', '')
    area.style.position = 'fixed'
    area.style.top = '0'
    area.style.left = '0'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.select()
    area.setSelectionRange(0, area.value.length)
    const copied = typeof document.execCommand === 'function' && document.execCommand('copy')
    document.body.removeChild(area)
    return copied
  } catch {
    return false
  }
}
