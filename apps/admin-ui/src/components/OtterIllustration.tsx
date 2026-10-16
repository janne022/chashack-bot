import { useState } from 'react'
import A1 from '@/assets/otter/A1.png'
import A2 from '@/assets/otter/A2.png'
import B1 from '@/assets/otter/B1.png'
import B2 from '@/assets/otter/B2.png'
import C1 from '@/assets/otter/C1.png'
import C2 from '@/assets/otter/C2.png'

const panels = { A1, A2, B1, B2, C1, C2 } as const

export function OtterIllustration({ panel, className = '' }: { panel: keyof typeof panels; className?: string }) {
  const [failed, setFailed] = useState(false)
  if (failed) return null
  return <img src={panels[panel]} alt="" aria-hidden="true" width={160} height={160} onError={() => setFailed(true)} className={`mx-auto size-40 shrink-0 object-contain ${className}`} />
}
