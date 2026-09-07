import { useState } from 'react'
import { LogIn, Zap } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input, Label } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

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
    <div className="grid min-h-screen place-items-center p-6">
      <Card className="w-full max-w-sm animate-fade-in">
        <CardHeader className="items-center text-center">
          <div className="mx-auto flex size-12 items-center justify-center rounded-xl bg-accent-soft text-accent">
            <Zap className="size-6" />
          </div>
          <CardTitle className="mt-2 text-xl">Hackathon Admin</CardTitle>
          <CardDescription>Organizer signups, teams and matching</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="flex flex-col gap-4">
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
            <Button type="submit" disabled={busy || password === ''}>
              <LogIn />
              {busy ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
