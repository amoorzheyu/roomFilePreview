import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  ArrowLeft,
  ArrowsInSimple,
  ArrowsOutSimple,
  CornersIn,
  CornersOut,
  Broadcast,
  Eye,
  EyeSlash,
  GithubLogo,
  PauseCircle,
  PlayCircle,
  UploadSimple,
  X,
} from '@phosphor-icons/react'

import type { RoomPublicState } from '../lib/api'
import { clearContent, closeRoom, getRoomState, pdfUrl, setShare, uploadRoomContent } from '../lib/api'
import { GITHUB_REPO_URL } from '../lib/config'
import { loadOwnerToken } from '../lib/roomTokens'
import { createSocket } from '../lib/socket'
import { MdViewer } from '../components/MdViewer'
import { PdfViewer } from '../components/PdfViewer'

function normalizeRoomId(input: string) {
  return input.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6)
}

function clamp01(n: number) {
  if (Number.isNaN(n)) return 0
  return Math.max(0, Math.min(1, n))
}

export function RoomPage() {
  const nav = useNavigate()
  const params = useParams()
  const roomId = useMemo(() => normalizeRoomId(params.roomId ?? ''), [params.roomId])

  const [state, setState] = useState<RoomPublicState | null>(null)
  const [isOwner, setIsOwner] = useState(false)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState<string | null>(null)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [isMaximized, setIsMaximized] = useState(false)

  const ownerToken = useMemo(() => (roomId ? loadOwnerToken(roomId) : null), [roomId])

  const scrollContainerRef = useRef<HTMLDivElement | null>(null)
  const applyingRemoteScrollRef = useRef(false)
  const stateRef = useRef<RoomPublicState | null>(null)
  const sockRef = useRef<ReturnType<typeof createSocket> | null>(null)
  const scrollSendTimerRef = useRef<number | null>(null)
  const lastSentAtRef = useRef(0)
  const latestVersion = state?.contentMeta?.version ?? 0

  useEffect(() => {
    stateRef.current = state
  }, [state])

  useEffect(() => {
    if (roomId.length !== 6) {
      nav('/', { replace: true })
      return
    }

    let cancelled = false
    setStatus('loading')
    setError(null)

    getRoomState(roomId)
      .then((st) => {
        if (cancelled) return
        setState(st)
        setStatus('ready')
      })
      .catch(() => {
        if (cancelled) return
        setStatus('error')
        setError('房间不存在或已关闭')
      })

    return () => {
      cancelled = true
    }
  }, [nav, roomId])

  useEffect(() => {
    const onChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement))
    }
    document.addEventListener('fullscreenchange', onChange)
    onChange()
    return () => {
      document.removeEventListener('fullscreenchange', onChange)
    }
  }, [])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      setIsMaximized(false)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [])

  async function onToggleFullscreen() {
    const el = scrollContainerRef.current
    if (!el) return

    if (document.fullscreenElement) {
      await document.exitFullscreen()
    } else {
      await el.requestFullscreen()
    }
  }

  function onToggleMaximize() {
    setIsMaximized((v) => !v)
  }

  useEffect(() => {
    if (status !== 'ready') return

    const sock = createSocket()
    sockRef.current = sock
    const token = ownerToken ?? undefined

    sock.emit('room:join', { roomId, ownerToken: token }, () => {})

    sock.on('room:state', (payload) => {
      setState(payload.state)
      setIsOwner(payload.isOwner)

      if (!payload.isOwner && scrollContainerRef.current && payload.state.contentMeta) {
        const el = scrollContainerRef.current
        const max = el.scrollHeight - el.clientHeight
        if (max > 0) {
          applyingRemoteScrollRef.current = true
          el.scrollTop = clamp01(payload.state.scroll.ratio) * max
          window.setTimeout(() => {
            applyingRemoteScrollRef.current = false
          }, 0)
        }
      }
    })

    sock.on('room:contentChanged', async () => {
      try {
        const st = await getRoomState(roomId)
        setState(st)
      } catch {
        // ignore
      }
    })

    sock.on('room:contentCleared', async () => {
      try {
        const st = await getRoomState(roomId)
        setState(st)
        if (scrollContainerRef.current) scrollContainerRef.current.scrollTop = 0
      } catch {
        // ignore
      }
    })

    sock.on('room:shareChanged', async () => {
      try {
        const st = await getRoomState(roomId)
        setState(st)
      } catch {
        // ignore
      }
    })

    sock.on('room:scrollSync', (payload) => {
      if (!scrollContainerRef.current) return
      const current = stateRef.current
      if ((current?.contentMeta?.version ?? 0) !== payload.version) return

      const el = scrollContainerRef.current
      const max = el.scrollHeight - el.clientHeight
      if (max <= 0) return

      applyingRemoteScrollRef.current = true
      el.scrollTop = payload.ratio * max
      window.setTimeout(() => {
        applyingRemoteScrollRef.current = false
      }, 0)
    })

    sock.on('room:closed', () => {
      nav('/', { replace: true })
    })

    sock.on('room:error', (payload) => {
      setError(payload.error)
    })

    return () => {
      if (scrollSendTimerRef.current) window.clearTimeout(scrollSendTimerRef.current)
      scrollSendTimerRef.current = null
      sockRef.current = null
      sock.disconnect()
    }
  }, [roomId, ownerToken, status, nav])

  useEffect(() => {
    const el = scrollContainerRef.current
    if (!el) return
    if (status !== 'ready') return

    const onScroll = () => {
      if (!isOwner) return
      if (!state?.shareEnabled) return
      if (!state?.contentMeta) return
      if (applyingRemoteScrollRef.current) return
      if (!sockRef.current) return

      const max = el.scrollHeight - el.clientHeight
      if (max <= 0) return
      const ratio = clamp01(el.scrollTop / max)

      const now = Date.now()
      const due = Math.max(0, 80 - (now - lastSentAtRef.current))
      if (scrollSendTimerRef.current) window.clearTimeout(scrollSendTimerRef.current)
      scrollSendTimerRef.current = window.setTimeout(() => {
        lastSentAtRef.current = Date.now()
        sockRef.current?.emit('room:scroll', {
          roomId,
          version: state.contentMeta!.version,
          ratio,
          kind: state.contentMeta!.type,
        })
      }, due)
    }

    el.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      el.removeEventListener('scroll', onScroll)
    }
  }, [isOwner, roomId, state, status])

  const [uploadBusy, setUploadBusy] = useState(false)
  const [ownerActionError, setOwnerActionError] = useState<string | null>(null)

  async function onUpload(file: File) {
    if (!ownerToken) {
      setOwnerActionError('缺少房主 token，无法上传 请从创建房间的那台设备进入')
      return
    }
    setOwnerActionError(null)
    setUploadBusy(true)
    try {
      await uploadRoomContent({ roomId, ownerToken, file })
      const st = await getRoomState(roomId)
      setState(st)
    } catch {
      setOwnerActionError('上传失败 请确认文件类型为 PDF 或 Markdown')
    } finally {
      setUploadBusy(false)
    }
  }

  async function onToggleShare(next: boolean) {
    if (!ownerToken) return
    try {
      await setShare({ roomId, ownerToken, enabled: next })
      const st = await getRoomState(roomId)
      setState(st)
    } catch {
      setOwnerActionError('更新共享状态失败')
    }
  }

  async function onClear() {
    if (!ownerToken) return
    try {
      await clearContent({ roomId, ownerToken })
      const st = await getRoomState(roomId)
      setState(st)
    } catch {
      setOwnerActionError('清空失败')
    }
  }

  async function onCloseRoom() {
    if (!ownerToken) return
    try {
      await closeRoom({ roomId, ownerToken })
      nav('/', { replace: true })
    } catch {
      setOwnerActionError('关闭房间失败')
    }
  }

  const contentType = state?.contentMeta?.type

  return (
    <div className="min-h-[100dvh]">
      <div className="mx-auto max-w-[1400px] px-6 py-6 md:px-10">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => nav('/')}
              className="inline-flex items-center gap-2 rounded-md border border-warm-charcoal bg-carbon px-3 py-2 text-sm text-snow transition hover:bg-black/20 active:translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50"
            >
              <ArrowLeft size={16} weight="bold" />
              返回
            </button>
            <div>
              <div className="text-xs text-steel">房间号</div>
              <div className="font-mono text-lg font-semibold tracking-widest text-snow">
                {roomId}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <a
              href={GITHUB_REPO_URL}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 rounded-md border border-warm-charcoal bg-carbon px-3 py-2 text-xs font-semibold text-snow transition hover:bg-black/20 active:translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50"
              aria-label="在 GitHub 查看项目"
              title="GitHub"
            >
              <GithubLogo size={16} weight="bold" />
              GitHub
            </a>
            <div className="inline-flex items-center gap-2 rounded-full border border-warm-charcoal bg-carbon px-3 py-1 text-xs text-parchment shadow-ambient">
              <Broadcast size={14} weight="bold" className="text-steel" />
              {isOwner ? '房主' : '观众'}
            </div>
            {state ? (
              <div className="text-xs text-steel">
                {state.shareEnabled ? '共享中' : '已暂停'} · v{latestVersion}
              </div>
            ) : null}
          </div>
        </div>

        {status === 'loading' ? (
          <div className="mt-8 grid gap-4">
            <div className="h-10 w-[320px] animate-pulse rounded-lg bg-carbon ring-1 ring-warm-charcoal" />
            <div className="h-[520px] w-full animate-pulse rounded-lg bg-carbon ring-1 ring-warm-charcoal" />
          </div>
        ) : status === 'error' ? (
          <div className="mt-10 rounded-lg border border-danger-border bg-danger-bg p-6 text-sm text-danger">
            {error ?? '加载失败'}
          </div>
        ) : (
          <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-[0.72fr_0.28fr]">
            <div
              className={
                isMaximized
                  ? 'fixed inset-0 z-40 grid bg-abyss/95 p-4 backdrop-blur-sm md:p-6'
                  : 'rounded-lg border border-warm-charcoal bg-carbon shadow-ambient'
              }
            >
              <div
                className={
                  isMaximized
                    ? 'flex h-full flex-col overflow-hidden rounded-lg border border-warm-charcoal bg-carbon shadow-dramatic'
                    : ''
                }
              >
                <div className="flex items-center justify-between border-b border-warm-charcoal px-5 py-4">
                  <div className="text-sm font-medium text-snow">内容</div>
                  <div className="flex items-center gap-3">
                    <div className="text-xs text-steel">{state?.contentMeta ? state.contentMeta.name : ''}</div>
                    <button
                      type="button"
                      onClick={onToggleMaximize}
                      className="inline-flex items-center gap-2 rounded-md border border-warm-charcoal bg-abyss px-3 py-2 text-xs font-semibold text-snow transition hover:bg-black/30 active:translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50"
                      title={isMaximized ? '还原' : '最大化'}
                    >
                      {isMaximized ? <CornersIn size={16} weight="bold" /> : <CornersOut size={16} weight="bold" />}
                      {isMaximized ? '还原' : '最大化'}
                    </button>
                    <button
                      type="button"
                      onClick={onToggleFullscreen}
                      className="inline-flex items-center gap-2 rounded-md border border-warm-charcoal bg-abyss px-3 py-2 text-xs font-semibold text-snow transition hover:bg-black/30 active:translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50"
                      title={isFullscreen ? '退出全屏' : '全屏'}
                    >
                      {isFullscreen ? (
                        <ArrowsInSimple size={16} weight="bold" />
                      ) : (
                        <ArrowsOutSimple size={16} weight="bold" />
                      )}
                      {isFullscreen ? '退出全屏' : '全屏'}
                    </button>
                  </div>
                </div>

                <div
                  ref={scrollContainerRef}
                  className={isMaximized ? 'flex-1 overflow-auto px-5 py-5' : 'max-h-[72dvh] overflow-auto px-5 py-5'}
                >
                  {!state?.contentMeta ? (
                    <div className="grid gap-2 rounded-lg border border-warm-charcoal bg-abyss p-6">
                      <div className="inline-flex items-center gap-2 text-sm font-semibold text-snow">
                        <Eye size={18} weight="bold" className="text-steel" />
                        暂无内容
                      </div>
                    </div>
                  ) : contentType === 'md' ? (
                    <MdViewer roomId={roomId} version={state.contentMeta.version} />
                  ) : (
                    <PdfViewer url={pdfUrl(roomId)} version={state.contentMeta.version} />
                  )}
                </div>
              </div>
            </div>

            <div className="grid gap-4">
              {!isOwner && state ? (
                <div
                  className={`rounded-lg p-4 shadow-ambient ${
                    state.shareEnabled
                      ? 'border-2 border-signal bg-carbon'
                      : 'border border-[rgba(255,186,0,0.38)] bg-[rgba(255,186,0,0.07)]'
                  }`}
                  role="status"
                  aria-live="polite"
                >
                  <div className="flex items-start gap-3">
                    {state.shareEnabled ? (
                      <PlayCircle
                        size={22}
                        weight="bold"
                        className="mt-0.5 shrink-0 text-mint"
                        aria-hidden
                      />
                    ) : (
                      <PauseCircle
                        size={22}
                        weight="bold"
                        className="mt-0.5 shrink-0 text-[#ffba00]"
                        aria-hidden
                      />
                    )}
                    <div className="min-w-0">
                      <div className="text-sm font-semibold leading-snug text-snow">
                        {state.shareEnabled ? '房主正在共享' : '房主已暂停共享'}
                      </div>
                      <div className="mt-1 text-xs leading-relaxed text-parchment">
                        {state.shareEnabled
                          ? '滚动将与房主同步。'
                          : '滚动不再与房主同步；当前页面内容仍保留。'}
                      </div>
                    </div>
                  </div>
                </div>
              ) : null}

              <div
                className={`rounded-lg border bg-carbon p-5 shadow-ambient ${
                  state?.shareEnabled ? 'border-signal border-2' : 'border-warm-charcoal'
                }`}
              >
                <div className="text-sm font-medium text-snow">控制</div>

                {isOwner ? (
                  <div className="mt-4 grid gap-3">
                    <label className="grid gap-2">
                      <span className="text-xs text-steel">上传</span>
                      <input
                        type="file"
                        accept=".pdf,.md,.markdown"
                        disabled={uploadBusy}
                        onChange={(e) => {
                          const f = e.target.files?.[0]
                          if (!f) return
                          onUpload(f)
                          e.currentTarget.value = ''
                        }}
                        className="block w-full rounded-md border border-warm-charcoal bg-abyss px-4 py-3 text-sm text-snow file:mr-4 file:rounded-md file:border-0 file:bg-warm-charcoal file:px-3 file:py-2 file:text-xs file:font-semibold file:text-snow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50"
                      />
                    </label>

                    <button
                      type="button"
                      onClick={() => onToggleShare(!state?.shareEnabled)}
                      className="inline-flex w-full items-center justify-between rounded-md border border-warm-charcoal bg-carbon px-4 py-3 text-sm font-semibold text-snow transition hover:bg-black/20 active:translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50"
                    >
                      <span className="inline-flex items-center gap-2">
                        {state?.shareEnabled ? (
                          <EyeSlash size={18} weight="bold" />
                        ) : (
                          <Eye size={18} weight="bold" />
                        )}
                        {state?.shareEnabled ? '暂停共享' : '继续共享'}
                      </span>
                      <UploadSimple size={18} weight="bold" className="text-steel" />
                    </button>

                    <button
                      type="button"
                      onClick={onClear}
                      className="inline-flex w-full items-center justify-between rounded-md border border-warm-charcoal bg-abyss px-4 py-3 text-sm font-semibold text-snow transition hover:bg-black/30 active:translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50"
                    >
                      <span className="inline-flex items-center gap-2">
                        <X size={18} weight="bold" />
                        清空内容
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={onCloseRoom}
                      className="inline-flex w-full items-center justify-between rounded-md border border-danger-border bg-danger-bg px-4 py-3 text-sm font-semibold text-danger transition hover:opacity-90 active:translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50"
                    >
                      <span className="inline-flex items-center gap-2">
                        <X size={18} weight="bold" />
                        关闭房间
                      </span>
                    </button>

                    {ownerActionError ? (
                      <div className="rounded-lg border border-danger-border bg-danger-bg px-4 py-3 text-xs text-danger">
                        {ownerActionError}
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <div className="mt-4 rounded-lg border border-warm-charcoal bg-abyss p-4 text-sm text-parchment">
                    仅查看
                  </div>
                )}
              </div>

              <div className="rounded-lg border border-warm-charcoal bg-carbon p-5 text-xs text-steel shadow-ambient">
                滚动跟随房主
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
