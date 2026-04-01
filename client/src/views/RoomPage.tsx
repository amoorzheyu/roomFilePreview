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
  UploadSimple,
  X,
} from '@phosphor-icons/react'

import type { RoomPublicState } from '../lib/api'
import { clearContent, closeRoom, getRoomState, pdfUrl, setShare, uploadRoomContent } from '../lib/api'
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
        setError('房间不存在或已关闭。')
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      setOwnerActionError('缺少房主 token，无法上传。请从创建房间的那台设备进入。')
      return
    }
    setOwnerActionError(null)
    setUploadBusy(true)
    try {
      await uploadRoomContent({ roomId, ownerToken, file })
      const st = await getRoomState(roomId)
      setState(st)
    } catch {
      setOwnerActionError('上传失败，请确认文件类型为 PDF 或 Markdown。')
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
      setOwnerActionError('更新共享状态失败。')
    }
  }

  async function onClear() {
    if (!ownerToken) return
    try {
      await clearContent({ roomId, ownerToken })
      const st = await getRoomState(roomId)
      setState(st)
    } catch {
      setOwnerActionError('清空失败。')
    }
  }

  async function onCloseRoom() {
    if (!ownerToken) return
    try {
      await closeRoom({ roomId, ownerToken })
      nav('/', { replace: true })
    } catch {
      setOwnerActionError('关闭房间失败。')
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
              className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-zinc-100 transition hover:bg-white/8 active:translate-y-[1px]"
            >
              <ArrowLeft size={16} weight="bold" />
              返回
            </button>
            <div>
              <div className="text-xs text-zinc-200/55">房间号</div>
              <div className="font-mono text-lg font-semibold tracking-widest text-zinc-50">
                {roomId}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-zinc-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
              <Broadcast size={14} weight="bold" />
              {isOwner ? '你是房主' : '观众'}
            </div>
            {state ? (
              <div className="text-xs text-zinc-200/55">
                共享：{state.shareEnabled ? '开启' : '暂停'} · 版本：{latestVersion}
              </div>
            ) : null}
          </div>
        </div>

        {status === 'loading' ? (
          <div className="mt-8 grid gap-4">
            <div className="h-10 w-[320px] animate-pulse rounded-2xl bg-white/5" />
            <div className="h-[520px] w-full animate-pulse rounded-[28px] bg-white/5" />
          </div>
        ) : status === 'error' ? (
          <div className="mt-10 rounded-[28px] border border-rose-500/25 bg-rose-500/10 p-6 text-sm text-rose-100">
            {error ?? '加载失败。'}
          </div>
        ) : (
          <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-[0.72fr_0.28fr]">
            <div
              className={
                isMaximized
                  ? 'fixed inset-0 z-40 grid bg-[#0b0d12]/92 p-4 backdrop-blur-md md:p-6'
                  : 'rounded-[28px] border border-white/10 bg-white/5 shadow-[0_20px_40px_-15px_rgba(0,0,0,0.35),inset_0_1px_0_rgba(255,255,255,0.08)]'
              }
            >
              <div
                className={
                  isMaximized
                    ? 'flex h-full flex-col overflow-hidden rounded-[28px] border border-white/10 bg-white/5 shadow-[0_20px_40px_-15px_rgba(0,0,0,0.35),inset_0_1px_0_rgba(255,255,255,0.08)]'
                    : ''
                }
              >
              <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
                <div className="text-sm font-medium text-zinc-100">预览</div>
                <div className="flex items-center gap-3">
                  <div className="text-xs text-zinc-200/55">
                    {state?.contentMeta ? state.contentMeta.name : '暂无内容'}
                  </div>
                  <button
                    type="button"
                    onClick={onToggleMaximize}
                    className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-zinc-100 transition hover:bg-white/8 active:translate-y-[1px]"
                    title={isMaximized ? '还原' : '最大化'}
                  >
                    {isMaximized ? <CornersIn size={16} weight="bold" /> : <CornersOut size={16} weight="bold" />}
                    {isMaximized ? '还原' : '最大化'}
                  </button>
                  <button
                    type="button"
                    onClick={onToggleFullscreen}
                    className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-zinc-100 transition hover:bg-white/8 active:translate-y-[1px]"
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
                  <div className="grid gap-2 rounded-2xl border border-white/10 bg-black/20 p-6">
                    <div className="inline-flex items-center gap-2 text-sm font-semibold text-zinc-100">
                      <Eye size={18} weight="bold" />
                      等待内容
                    </div>
                    <div className="text-sm text-zinc-200/60">
                      房主上传 PDF 或 Markdown 后，会在这里渲染并同步滚动。
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
              <div className="rounded-[28px] border border-white/10 bg-white/5 p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
                <div className="text-sm font-medium text-zinc-100">控制</div>
                <div className="mt-1 text-xs text-zinc-200/55">
                  只有房主可以上传与控制共享。
                </div>

                {isOwner ? (
                  <div className="mt-4 grid gap-3">
                    <label className="grid gap-2">
                      <span className="text-xs text-zinc-200/55">上传 PDF / Markdown（覆盖）</span>
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
                        className="block w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-zinc-100 file:mr-4 file:rounded-xl file:border-0 file:bg-white/10 file:px-3 file:py-2 file:text-xs file:font-semibold file:text-zinc-100"
                      />
                    </label>

                    <button
                      type="button"
                      onClick={() => onToggleShare(!state?.shareEnabled)}
                      className="inline-flex w-full items-center justify-between rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-zinc-100 transition hover:bg-white/8 active:translate-y-[1px]"
                    >
                      <span className="inline-flex items-center gap-2">
                        {state?.shareEnabled ? (
                          <EyeSlash size={18} weight="bold" />
                        ) : (
                          <Eye size={18} weight="bold" />
                        )}
                        {state?.shareEnabled ? '停止共享' : '恢复共享'}
                      </span>
                      <UploadSimple size={18} weight="bold" className="opacity-60" />
                    </button>

                    <button
                      type="button"
                      onClick={onClear}
                      className="inline-flex w-full items-center justify-between rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm font-semibold text-zinc-100 transition hover:bg-white/8 active:translate-y-[1px]"
                    >
                      <span className="inline-flex items-center gap-2">
                        <X size={18} weight="bold" />
                        清空内容
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={onCloseRoom}
                      className="inline-flex w-full items-center justify-between rounded-2xl border border-rose-500/25 bg-rose-500/10 px-4 py-3 text-sm font-semibold text-rose-100 transition hover:bg-rose-500/14 active:translate-y-[1px]"
                    >
                      <span className="inline-flex items-center gap-2">
                        <X size={18} weight="bold" />
                        关闭房间
                      </span>
                    </button>

                    {ownerActionError ? (
                      <div className="rounded-2xl border border-rose-500/25 bg-rose-500/10 px-4 py-3 text-xs text-rose-100">
                        {ownerActionError}
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <div className="mt-4 rounded-2xl border border-white/10 bg-black/20 p-4 text-sm text-zinc-200/70">
                    你在以观众身份观看。滚动会跟随房主同步。
                  </div>
                )}
              </div>

              <div className="rounded-[28px] border border-white/10 bg-white/5 p-5 text-xs text-zinc-200/55 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
                房主滚动会同步给观众。若你是观众，本地滚动会被下一次同步覆盖。
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
