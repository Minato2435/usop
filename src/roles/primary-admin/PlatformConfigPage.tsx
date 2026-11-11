import { useEffect, useState } from 'react'
import { PrimaryAdminShell } from './shell/PrimaryAdminShell'
import { Badge, PrimaryButton, Skeleton } from './shell/ui'
import { Icon } from './shell/Icon'
import { watchPlatformConfig, setPlatformTheme } from '../../lib/firestore/platformConfig'
import { useAuth } from '../../auth/AuthContext'
import type { PlatformConfig, PlatformTheme } from '../../types'

// Literal hex values per theme, kept in sync by hand with the
// html[data-theme="..."] blocks in src/index.css — deliberately not
// Tailwind utility classes here, since those would only ever reflect
// whichever theme is *currently* active. These previews need to show all
// three palettes side by side regardless of which one is live.
const THEMES: {
  id: PlatformTheme
  name: string
  description: string
  ink: string
  paper: string
  accent: string
  secondary: string
}[] = [
  {
    id: 'inkGold',
    name: 'Ink & Gold',
    description: 'Navy ink, antique brass, warm cream — the original classical panel.',
    ink: '#0b1220',
    paper: '#f4f2ec',
    accent: '#b8863b',
    secondary: '#2f7a6b',
  },
  {
    id: 'clinicalTeal',
    name: 'Clinical Teal',
    description: 'Slate-blue-black, crisp cool white, clinical teal — modern hospital-tech mood.',
    ink: '#0f1b24',
    paper: '#f2f6f5',
    accent: '#1f7a6c',
    secondary: '#3f6b99',
  },
  {
    id: 'emeraldLedger',
    name: 'Emerald Ledger',
    description: 'Forest-green ink, warm parchment, emerald accent — a scholarly archive mood.',
    ink: '#14201a',
    paper: '#f5f1e4',
    accent: '#3f7d52',
    secondary: '#a67c3d',
  },
  {
    id: 'monochrome',
    name: 'Monochrome',
    description: 'Near-black ink, crisp white paper, graphite accent — a stark editorial mood.',
    ink: '#0a0a0a',
    paper: '#f7f7f7',
    accent: '#595959',
    secondary: '#4b5563',
  },
  {
    id: 'deepBlue',
    name: 'Deep Blue',
    description: 'Rich indigo ink, cool white paper, royal blue accent — a single-hue corporate mood.',
    ink: '#0b1e3d',
    paper: '#f5f8fc',
    accent: '#2e5fa3',
    secondary: '#6c8fbd',
  },
  {
    id: 'midnight',
    name: 'Midnight',
    description: 'The one true dark mode — dark canvas throughout, glowing tangerine accent, light text.',
    ink: '#05070c',
    paper: '#12151c',
    accent: '#e8873e',
    secondary: '#4fa294',
  },
  {
    id: 'classical',
    name: 'Classical',
    description: 'Warm bronze and charcoal, no blues or grays — parchment paper, near-black sidebar, ochre accents.',
    ink: '#2d2b2b',
    paper: '#f3f2f2',
    accent: '#7d5411',
    secondary: '#ac803e',
  },
  {
    id: 'spruceAmber',
    name: 'Spruce & Amber',
    description: 'Deep spruce-green sidebar, cool off-white paper, amber reserved strictly for what needs attention.',
    ink: '#0f211d',
    paper: '#eaeee9',
    accent: '#0f6b54',
    secondary: '#9c6109',
  },
  {
    id: 'clarity',
    name: 'Clarity',
    description: 'Built for legibility above mood — verified ~16.6:1 text contrast and one confident accent, nothing washed out.',
    ink: '#171b21',
    paper: '#f6f6f4',
    accent: '#1d4e89',
    secondary: '#2f7d5a',
  },
]

export function PrimaryAdminPlatformConfigPage() {
  const { appUser } = useAuth()
  const [config, setConfig] = useState<PlatformConfig | null | undefined>(undefined)
  const [applying, setApplying] = useState<PlatformTheme | null>(null)

  useEffect(() => watchPlatformConfig(setConfig), [])

  const activeTheme: PlatformTheme = config?.theme ?? 'inkGold'
  const loading = config === undefined

  async function handleApply(theme: PlatformTheme) {
    setApplying(theme)
    await setPlatformTheme(theme, appUser?.uid ?? '')
    setApplying(null)
  }

  return (
    <PrimaryAdminShell eyebrow="System" title="Platform configuration">
      {/* mx-auto was missing here, so on any viewport wide enough for
          max-w-5xl to actually bind (sidebar collapsed, large screen) the
          whole card grid hugged the left edge instead of sitting centered
          like the rest of the page. Also switched grid → flex-wrap +
          justify-center: with grid, an incomplete last row (7 themes across
          3 columns leaves one alone) stays pinned to the row's start
          instead of centering — flex-wrap centers leftover cards too. */}
      <div className="max-w-5xl mx-auto">
        <p className="text-[13.5px] leading-relaxed mb-7" style={{ color: 'var(--color-char-soft)' }}>
          Pick the color theme for the entire Primary Admin panel. Applying one changes every
          color across the interface immediately, for everyone — not just a local preference.
        </p>

        {loading ? (
          <div className="flex flex-wrap justify-center gap-4">
            {THEMES.map((t) => (
              <Skeleton key={t.id} className="h-56 w-full sm:w-[calc((100%-2rem)/3)]" />
            ))}
          </div>
        ) : (
          <div className="flex flex-wrap justify-center gap-4">
            {THEMES.map((theme) => {
              const isActive = theme.id === activeTheme
              return (
                <div
                  key={theme.id}
                  className="w-full sm:w-[calc((100%-2rem)/3)] rounded-[10px] border overflow-hidden transition-all duration-200"
                  style={{
                    borderColor: isActive ? theme.accent : 'var(--color-line)',
                    boxShadow: isActive ? `0 0 0 2px color-mix(in srgb, ${theme.accent} 35%, transparent)` : undefined,
                    backgroundColor: 'var(--color-paper-raised)',
                  }}
                >
                  {/* Preview swatch — built from this theme's own literal
                      hex values, not the live CSS tokens. */}
                  <div className="relative" style={{ height: 96, backgroundColor: theme.ink }}>
                    <div
                      className="absolute inset-x-3 bottom-3 rounded-[6px]"
                      style={{ height: 40, backgroundColor: theme.paper }}
                    />
                    <div
                      className="absolute rounded-full"
                      style={{ width: 18, height: 18, top: 14, left: 14, backgroundColor: theme.accent }}
                    />
                    <div
                      className="absolute rounded-full"
                      style={{ width: 12, height: 12, top: 18, left: 40, backgroundColor: theme.secondary }}
                    />
                  </div>

                  <div className="p-4">
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <div className="font-display text-[17px] leading-snug" style={{ color: 'var(--color-char)' }}>
                        {theme.name}
                      </div>
                      {isActive && <Badge tone="gold">Active</Badge>}
                    </div>
                    <p className="text-[12px] leading-relaxed mb-4" style={{ color: 'var(--color-char-soft)' }}>
                      {theme.description}
                    </p>
                    {isActive ? (
                      <div
                        className="inline-flex items-center gap-1.5 text-[12px] font-medium"
                        style={{ color: 'var(--color-char-soft)' }}
                      >
                        <Icon name="eye" className="h-3.5 w-3.5" />
                        Currently applied
                      </div>
                    ) : (
                      <PrimaryButton onClick={() => handleApply(theme.id)} disabled={applying !== null}>
                        {applying === theme.id ? 'Applying…' : 'Apply this theme'}
                      </PrimaryButton>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </PrimaryAdminShell>
  )
}
