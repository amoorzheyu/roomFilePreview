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
      <div className="pointer-events-none fixed inset-0 opacity-80">
        <div className="orb-float absolute -left-40 -top-40 h-[520px] w-[520px] rounded-full bg-emerald-500/12 blur-3xl" />
        <div className="orb-float absolute -bottom-52 right-[-220px] h-[620px] w-[620px] rounded-full bg-sky-500/10 blur-3xl [animation-delay:-3s]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(255,255,255,0.08),transparent_55%),radial-gradient(circle_at_70%_70%,rgba(16,185,129,0.10),transparent_60%)]" />
      </div>
      <div className="bg-grain" />

      <div className="flex min-h-[100dvh] items-center">
        <div className="mx-auto w-full grid max-w-[1040px] grid-cols-1 gap-6 px-6 py-12 md:grid-cols-[1fr_420px] md:gap-4 md:px-10">
        <div className="relative">
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-zinc-200/90 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
              <HashStraight size={14} weight="bold" />
              房主控制滚动
            </div>
            <a
              href={GITHUB_REPO_URL}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-zinc-200/90 transition hover:bg-white/8 active:translate-y-[1px] shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]"
              aria-label="在 GitHub 查看项目"
              title="GitHub"
            >
              <GithubLogo size={14} weight="bold" />
              GitHub
            </a>
          </div>

          <h1 className="mt-6 text-4xl font-semibold tracking-tight text-zinc-50 md:text-6xl md:leading-[0.98]">
            同步预览
            <span className="block text-zinc-200/80">PDF 与 Markdown</span>
          </h1>

          <div className="mt-5 flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-zinc-200/80 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
              <span className="pulse-soft inline-block h-1.5 w-1.5 rounded-full bg-emerald-400/90" />
              实时同步
            </span>
            <span className="inline-flex items-center rounded-full border border-white/10 bg-black/20 px-3 py-1 text-xs text-zinc-200/70">
              PDF
            </span>
            <span className="inline-flex items-center rounded-full border border-white/10 bg-black/20 px-3 py-1 text-xs text-zinc-200/70">
              Markdown
            </span>
          </div>

          {error ? (
            <div className="mt-6 rounded-2xl border border-rose-500/25 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
              {error}
            </div>
          ) : null}
        </div>

        <div className="relative">
          <div className="rounded-[28px] border border-white/10 bg-white/5 p-6 shadow-[0_20px_40px_-15px_rgba(0,0,0,0.35),inset_0_1px_0_rgba(255,255,255,0.08)]">
            <div className="grid gap-3">
              <div className="text-sm font-medium text-zinc-100">创建</div>
              <button
                type="button"
                onClick={onCreate}
                disabled={busy !== null}
                className="group inline-flex w-full items-center justify-between rounded-2xl bg-emerald-500/90 px-4 py-3 text-sm font-semibold text-emerald-950 transition hover:bg-emerald-500/95 active:translate-y-[1px] disabled:opacity-60"
              >
                <span className="inline-flex items-center gap-2">
                  <Plus size={18} weight="bold" />
                  创建房间
                </span>
                <ArrowRight size={18} weight="bold" className="opacity-80 transition group-hover:translate-x-[2px]" />
              </button>
            </div>

            <div className="my-6 h-px bg-white/10" />

            <div className="grid gap-3">
              <div className="text-sm font-medium text-zinc-100">加入</div>
              <label className="grid gap-2">
                <span className="text-xs text-zinc-200/60">房间号</span>
                <input
                  value={roomId}
                  onChange={(e) => setRoomIdRaw(e.target.value)}
                  placeholder="房间号"
                  inputMode="text"
                  autoComplete="off"
                  className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 font-mono text-sm tracking-wider text-zinc-100 outline-none transition focus:border-emerald-500/40 focus:bg-black/30"
                />
              </label>
              <button
                type="button"
                onClick={onJoin}
                disabled={busy !== null || roomId.length !== 6}
                className="inline-flex w-full items-center justify-between rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-zinc-100 transition hover:bg-white/8 active:translate-y-[1px] disabled:opacity-50"
              >
                <span>进入</span>
                <ArrowRight size={18} weight="bold" className="opacity-70" />
              </button>
              <div className="text-xs text-zinc-200/50">创建者会自动恢复控制权</div>
            </div>
          </div>

          <div className="mt-4 text-xs text-zinc-200/45" />
        </div>
      </div>
      </div>
    </div>
  )
}

