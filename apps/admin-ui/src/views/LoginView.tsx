import { useState } from 'react'
import { LogIn } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input, Label } from '@/components/ui/input'
import brandMark from '@/assets/brand/1.png'
import wordmark from '@/assets/brand/4.png'

export function LoginView({ onLogin }: { onLogin: (password: string) => Promise<void> }) {
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await onLogin(password)
    } catch {
      setError('Wrong password. Try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="hex-bg grid min-h-screen place-items-center p-6">
      <div className="w-full max-w-sm animate-pop-in">
        <div className="mb-6 flex flex-col items-center text-center">
          <img src={brandMark} alt="ChasHack" className="size-20 drop-shadow-[0_0_24px_rgba(85,187,218,0.35)]" />
          <img src={wordmark} alt="ChasHack" className="-mt-2 max-w-56 mix-blend-screen" />
          <p className="mt-3 text-sm text-muted-foreground">Organizer console — sign in to run the event</p>
        </div>
        <form onSubmit={submit} className="flex flex-col gap-4 rounded-2xl border border-border bg-surface p-6 shadow-2xl">
          <div className="flex flex-col gap-2">
            <Label htmlFor="password">Admin password</Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              autoFocus
              required
            />
          </div>
          {error !== null && <p className="text-sm text-danger">{error}</p>}
          <Button type="submit" disabled={busy || password === ''} className="font-display">
            <LogIn />
            {busy ? 'Signing in…' : 'Enter the hive'}
          </Button>
        </form>
      </div>
    </div>
  )
}
