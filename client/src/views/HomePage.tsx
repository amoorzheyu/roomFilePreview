import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, GithubLogo, HashStraight, Plus } from '@phosphor-icons/react'

import { createRoom } from '../lib/api'
import { GITHUB_REPO_URL } from '../lib/config'
import { saveOwnerToken } from '../lib/roomTokens'

function normalizeRoomId(input: string) {
  return input.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6)
}

export function HomePage() {
  const nav = useNavigate()
  const [roomIdRaw, setRoomIdRaw] = useState('')
  const roomId = useMemo(() => normalizeRoomId(roomIdRaw), [roomIdRaw])

  const [busy, setBusy] = useState<'create' | 'join' | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function onCreate() {
    setError(null)
    setBusy('create')
    try {
      const { roomId, ownerToken } = await createRoom()
      saveOwnerToken(roomId, ownerToken)
      nav(`/room/${roomId}`)
    } catch {
      setError('创建房间失败，请稍后重试')
    } finally {
      setBusy(null)
    }
  }

  async function onJoin() {
    setError(null)
    setBusy('join')
    try {
      nav(`/room/${roomId}`)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="min-h-[100dvh]">
      <div className="pointer-events-none fixed inset-0 opacity-90">
        <div className="orb-float absolute -left-40 -top-40 h-[520px] w-[520px] rounded-full bg-signal/10 blur-3xl" />
        <div className="orb-float absolute -bottom-52 right-[-220px] h-[520px] w-[520px] rounded-full bg-[rgba(92,88,85,0.15)] blur-3xl [animation-delay:-3s]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(0,217,146,0.06),transparent_55%),radial-gradient(circle_at_70%_70%,rgba(61,58,57,0.12),transparent_60%)]" />
      </div>
      <div className="bg-grain" />

      <div className="flex min-h-[100dvh] items-center">
        <div className="mx-auto grid w-full max-w-[1040px] grid-cols-1 gap-6 px-6 py-12 md:grid-cols-[1fr_420px] md:gap-8 md:px-10">
          <div className="relative">
            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex items-center gap-2 rounded-full border border-warm-charcoal bg-carbon px-3 py-1 text-xs text-parchment shadow-ambient">
                <HashStraight size={14} weight="bold" className="text-steel" />
                房主控制滚动
              </div>
              <a
                href={GITHUB_REPO_URL}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 rounded-full border border-warm-charcoal bg-carbon px-3 py-1 text-xs text-parchment shadow-ambient transition hover:bg-black/20 active:translate-y-px"
                aria-label="在 GitHub 查看项目"
                title="GitHub"
              >
                <GithubLogo size={14} weight="bold" className="text-steel" />
                GitHub
              </a>
            </div>

            <h1 className="mt-6 font-sans text-4xl font-normal tracking-[-0.04em] text-snow md:text-6xl md:leading-[1.0]">
              同步预览
              <span className="mt-1 block text-signal">PDF 与 Markdown</span>
            </h1>

            <div className="mt-5 flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-2 rounded-full border border-warm-charcoal bg-carbon px-3 py-1 text-xs text-parchment shadow-ambient">
                <span className="pulse-soft inline-block h-1.5 w-1.5 rounded-full bg-signal" />
                实时同步
              </span>
              <span className="inline-flex items-center rounded-full border border-warm-charcoal bg-abyss px-3 py-1 text-xs text-steel">
                PDF
              </span>
              <span className="inline-flex items-center rounded-full border border-warm-charcoal bg-abyss px-3 py-1 text-xs text-steel">
                Markdown
              </span>
            </div>

            {error ? (
              <div className="mt-6 rounded-lg border border-danger-border bg-danger-bg px-4 py-3 text-sm text-danger">
                {error}
              </div>
            ) : null}
          </div>

          <div className="relative">
            <div className="rounded-lg border border-warm-charcoal bg-carbon p-6 shadow-ambient">
              <div className="grid gap-3">
                <div className="text-sm font-medium text-snow">创建</div>
                <button
                  type="button"
                  onClick={onCreate}
                  disabled={busy !== null}
                  className="group inline-flex w-full items-center justify-between rounded-md border border-mint bg-carbon px-4 py-3 text-sm font-semibold text-mint outline-none ring-offset-2 ring-offset-abyss transition hover:bg-black/20 focus-visible:ring-2 focus-visible:ring-blue-500/50 disabled:opacity-60"
                >
                  <span className="inline-flex items-center gap-2">
                    <Plus size={18} weight="bold" />
                    创建房间
                  </span>
                  <ArrowRight size={18} weight="bold" className="opacity-90 transition group-hover:translate-x-0.5" />
                </button>
              </div>

              <div className="my-6 h-px bg-warm-charcoal" />

              <div className="grid gap-3">
                <div className="text-sm font-medium text-snow">加入</div>
                <label className="grid gap-2">
                  <span className="text-xs text-steel">房间号</span>
                  <input
                    value={roomId}
                    onChange={(e) => setRoomIdRaw(e.target.value)}
                    placeholder="房间号"
                    inputMode="text"
                    autoComplete="off"
                    className="w-full rounded-md border border-warm-charcoal bg-abyss px-4 py-3 font-mono text-sm tracking-wider text-snow placeholder:text-steel outline-none transition focus:border-signal focus:ring-2 focus:ring-blue-500/50"
                  />
                </label>
                <button
                  type="button"
                  onClick={onJoin}
                  disabled={busy !== null || roomId.length !== 6}
                  className="inline-flex w-full items-center justify-between rounded-md border border-warm-charcoal bg-carbon px-4 py-3 text-sm font-semibold text-snow transition hover:bg-black/20 active:translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50 disabled:opacity-50"
                >
                  <span>进入</span>
                  <ArrowRight size={18} weight="bold" className="text-steel" />
                </button>
                <div className="text-xs text-steel">创建者会自动恢复控制权</div>
              </div>
            </div>

            <div className="mt-4 text-xs text-steel/80" />
          </div>
        </div>
      </div>
    </div>
  )
}
