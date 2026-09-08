import { useMemo, useRef } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import type { Group } from 'three'

/**
 * HexHero — ambient 3D backdrop for the login screen.
 * A drifting field of flat hexagonal prisms (the ChasHack honeycomb motif),
 * tinted from the brand palette, rendered on a transparent canvas so the
 * page background shows through.
 */

const PALETTE = ['#55bbda', '#4e8780', '#c77fc7', '#f08080'] as const

type SpinAxis = 'x' | 'y' | 'z'

type HexSpec = {
  position: [number, number, number]
  rotation: [number, number, number]
  scale: number
  color: string
  floatSpeed: number
  floatAmplitude: number
  floatPhase: number
  spinSpeed: number
  spinAxis: SpinAxis
}

/** Deterministic PRNG so the field layout is stable between renders/reloads. */
function mulberry32(seed: number): () => number {
  let s = seed | 0
  return () => {
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function buildHexes(count: number): HexSpec[] {
  const rand = mulberry32(0xc0ffee)
  const hexes: HexSpec[] = []
  for (let i = 0; i < count; i++) {
    const colorIndex = Math.floor(rand() * PALETTE.length) % PALETTE.length
    hexes.push({
      position: [(rand() - 0.5) * 16, (rand() - 0.5) * 10, -4 + rand() * 6],
      rotation: [(rand() - 0.5) * Math.PI, (rand() - 0.5) * Math.PI, (rand() - 0.5) * Math.PI],
      scale: 0.25 + rand() * 0.65,
      color: PALETTE[colorIndex] ?? PALETTE[0],
      floatSpeed: 0.4 + rand() * 0.6,
      floatAmplitude: 0.15 + rand() * 0.25,
      floatPhase: rand() * Math.PI * 2,
      spinSpeed: (rand() - 0.5) * 0.4,
      spinAxis: (['x', 'y', 'z'] as const)[Math.floor(rand() * 3)] ?? 'y',
    })
  }
  return hexes
}

function Hexagon({ spec, animate }: { spec: HexSpec; animate: boolean }) {
  const ref = useRef<Group>(null)

  useFrame(({ clock }) => {
    if (!animate) return
    const group = ref.current
    if (group === null) return
    const t = clock.getElapsedTime()
    group.position.y = spec.position[1] + Math.sin(t * spec.floatSpeed + spec.floatPhase) * spec.floatAmplitude
    // three's Euler has no index signature, so write per-axis explicitly;
    // default Euler order 'XYZ' means x/y/z mirror the rotation tuple slots.
    const angle = t * spec.spinSpeed
    switch (spec.spinAxis) {
      case 'x':
        group.rotation.x = spec.rotation[0] + angle
        break
      case 'y':
        group.rotation.y = spec.rotation[1] + angle
        break
      case 'z':
        group.rotation.z = spec.rotation[2] + angle
        break
    }
  })

  return (
    <group ref={ref} position={spec.position} rotation={spec.rotation} scale={spec.scale}>
      <mesh>
        {/* 6 radial segments → flat hexagonal prism */}
        <cylinderGeometry args={[1, 1, 0.35, 6]} />
        <meshStandardMaterial color={spec.color} flatShading roughness={0.35} metalness={0.2} />
      </mesh>
    </group>
  )
}

export function HexHero() {
  const hexes = useMemo(() => buildHexes(30), [])
  const reducedMotion = useMemo(
    () =>
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    [],
  )

  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 overflow-hidden"
      style={{ background: 'transparent' }}
    >
      <Canvas
        camera={{ position: [0, 0, 8], fov: 55 }}
        dpr={[1, 1.5]}
        frameloop={reducedMotion ? 'demand' : 'always'}
        gl={{ alpha: true, antialias: true }}
        style={{ pointerEvents: 'none', background: 'transparent' }}
      >
        <ambientLight intensity={0.7} />
        <directionalLight position={[6, 8, 6]} intensity={1.4} />
        <pointLight position={[-6, -4, 4]} intensity={24} color="#55bbda" />
        {hexes.map((spec, i) => (
          <Hexagon key={i} spec={spec} animate={!reducedMotion} />
        ))}
      </Canvas>
    </div>
  )
}
