import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  ArrowLeft,
  ArrowsInSimple,
  ArrowsOutSimple,
  CornersIn,
  CornersOut,
  Broadcast,
  Cursor,
  Eye,
  EyeSlash,
  GithubLogo,
  Monitor,
  PauseCircle,
  PencilSimple,
  PlayCircle,
  TextT,
  Trash,
  X,
} from '@phosphor-icons/react'

import type {
  RoomAnnotationStroke,
  RoomAnnotationText,
  RoomPublicState,
} from '../lib/api'
import { clearContent, closeRoom, getRoomState, pdfUrl, setShare, uploadRoomContent } from '../lib/api'
import { GITHUB_REPO_URL } from '../lib/config'
import { loadOwnerToken } from '../lib/roomTokens'
import { createSocket } from '../lib/socket'
import { useRoomDesktopShare } from '../hooks/useRoomDesktopShare'
import { ContentAnnotations, type AnnotateTool } from '../components/ContentAnnotations'
import { MdViewer } from '../components/MdViewer'
import { PdfViewer } from '../components/PdfViewer'

const ANNOTATE_COLORS = [
  { hex: '#00d992', label: 'Signal' },
  { hex: '#2fd6a1', label: 'Mint' },
  { hex: '#818cf8', label: 'Indigo' },
  { hex: '#f2f2f2', label: 'Snow' },
  { hex: '#fb565b', label: 'Coral' },
  { hex: '#ffba00', label: 'Amber' },
] as const

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
  const contentBodyRef = useRef<HTMLDivElement | null>(null)
  const applyingRemoteScrollRef = useRef(false)
  const stateRef = useRef<RoomPublicState | null>(null)
  const sockRef = useRef<ReturnType<typeof createSocket> | null>(null)
  const [roomSocket, setRoomSocket] = useState<ReturnType<typeof createSocket> | null>(null)
  const scrollSendTimerRef = useRef<number | null>(null)
  const lastSentAtRef = useRef(0)
  const annotationEmitTimerRef = useRef<number | null>(null)
  const latestVersion = state?.contentMeta?.version ?? 0

  const {
    localVideoRef,
    remoteVideoRef,
    desktopError,
    setDesktopError,
    isHostSharing,
    isReceivingDesktop,
    startDesktopShare,
    stopDesktopShare,
  } = useRoomDesktopShare({
    socket: roomSocket,
    roomId,
    isOwner,
    enabled: status === 'ready' && Boolean(roomSocket),
  })

  const contentShowsDesktopOnly = useMemo(
    () => (isOwner && isHostSharing) || (!isOwner && isReceivingDesktop),
    [isOwner, isHostSharing, isReceivingDesktop],
  )

  const [ownerAnnStrokes, setOwnerAnnStrokes] = useState<RoomAnnotationStroke[]>([])
  const [ownerAnnTexts, setOwnerAnnTexts] = useState<RoomAnnotationText[]>([])

  useEffect(() => {
    stateRef.current = state
  }, [state])

  useEffect(() => {
    if (!isOwner || !state?.contentMeta) return
    const v = state.contentMeta.version
    const a = state.annotations
    if (a && a.contentVersion === v) {
      setOwnerAnnStrokes(a.strokes)
      setOwnerAnnTexts(a.texts)
    } else {
      setOwnerAnnStrokes([])
      setOwnerAnnTexts([])
    }
  }, [isOwner, state?.contentMeta?.version, state?.annotations])

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
    const el = contentBodyRef.current
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
    setRoomSocket(sock)
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

    sock.on('room:annotationsSync', (payload) => {
      setState((prev) => {
        if (!prev?.contentMeta || prev.contentMeta.version !== payload.version) return prev
        return {
          ...prev,
          annotations: {
            contentVersion: payload.version,
            strokes: payload.strokes,
            texts: payload.texts,
          },
        }
      })
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
      if (annotationEmitTimerRef.current) window.clearTimeout(annotationEmitTimerRef.current)
      annotationEmitTimerRef.current = null
      setRoomSocket(null)
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
  }, [isOwner, roomId, state, status, contentShowsDesktopOnly])

  const [uploadBusy, setUploadBusy] = useState(false)
  const [ownerActionError, setOwnerActionError] = useState<string | null>(null)

  const [annotateTool, setAnnotateTool] = useState<AnnotateTool>('pan')
  const [annotateColor, setAnnotateColor] = useState<string>(ANNOTATE_COLORS[0].hex)
  const [annotateStroke, setAnnotateStroke] = useState(3)
  const [annotateTextSize, setAnnotateTextSize] = useState(16)
  const [annotateResetSeq, setAnnotateResetSeq] = useState(0)

  const flushAnnotationsToServer = useCallback(
    (strokes: RoomAnnotationStroke[], texts: RoomAnnotationText[]) => {
      const sock = sockRef.current
      const st = stateRef.current
      if (!sock || !st?.contentMeta) return
      sock.emit('room:annotationsSet', {
        roomId,
        version: st.contentMeta.version,
        strokes,
        texts,
      })
    },
    [roomId],
  )

  const onAnnotationsChange = useCallback(
    (next: { strokes: RoomAnnotationStroke[]; texts: RoomAnnotationText[] }) => {
      setOwnerAnnStrokes(next.strokes)
      setOwnerAnnTexts(next.texts)
      if (annotationEmitTimerRef.current) window.clearTimeout(annotationEmitTimerRef.current)
      annotationEmitTimerRef.current = window.setTimeout(() => {
        annotationEmitTimerRef.current = null
        flushAnnotationsToServer(next.strokes, next.texts)
      }, 380)
    },
    [flushAnnotationsToServer],
  )

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

  const viewerAnn = useMemo(() => {
    if (isOwner) return null
    if (!state?.contentMeta || !state.annotations) return null
    if (state.annotations.contentVersion !== state.contentMeta.version) return null
    return state.annotations
  }, [isOwner, state?.contentMeta, state?.annotations])

  const annStrokes = isOwner ? ownerAnnStrokes : (viewerAnn?.strokes ?? [])
  const annTexts = isOwner ? ownerAnnTexts : (viewerAnn?.texts ?? [])

  return (
    <div className="flex min-h-[100dvh] flex-col lg:h-[100dvh] lg:max-h-[100dvh] lg:overflow-hidden">
      <div className="mx-auto flex w-full max-w-[1400px] flex-1 flex-col gap-8 px-6 py-6 md:px-10 lg:min-h-0">
        <div className="flex shrink-0 flex-col gap-4 md:flex-row md:items-end md:justify-between">
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
                {state.shareEnabled ? '文档同步中' : '文档已暂停'} · v{latestVersion}
              </div>
            ) : null}
          </div>
        </div>

        {status === 'loading' ? (
          <div className="grid gap-4">
            <div className="h-10 w-[320px] animate-pulse rounded-lg bg-carbon ring-1 ring-warm-charcoal" />
            <div className="h-[520px] w-full animate-pulse rounded-lg bg-carbon ring-1 ring-warm-charcoal" />
          </div>
        ) : status === 'error' ? (
          <div className="rounded-lg border border-danger-border bg-danger-bg p-6 text-sm text-danger">
            {error ?? '加载失败'}
          </div>
        ) : (
          <div className="grid min-h-0 flex-1 grid-cols-1 gap-6 lg:grid-cols-[0.72fr_0.28fr]">
            <div
              className={
                isMaximized
                  ? 'fixed inset-0 z-40 grid bg-abyss/95 p-4 backdrop-blur-sm md:p-6'
                  : 'flex min-h-0 flex-col lg:h-full lg:min-h-0'
              }
            >
              <div
                className={
                  isMaximized
                    ? 'flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-warm-charcoal bg-carbon shadow-dramatic'
                    : 'flex min-h-0 flex-1 flex-col rounded-lg border border-warm-charcoal bg-carbon shadow-ambient'
                }
              >
                <div className="flex shrink-0 items-center justify-between border-b border-warm-charcoal px-5 py-4">
                  <div className="text-sm font-medium text-snow">内容</div>
                  <div className="flex items-center gap-3">
                    <div className="text-xs text-steel">
                      {contentShowsDesktopOnly
                        ? isOwner
                          ? '桌面投屏'
                          : '接收房主桌面'
                        : state?.contentMeta
                          ? state.contentMeta.name
                          : ''}
                    </div>
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

                <div ref={contentBodyRef} className="flex min-h-0 flex-1 flex-col">
                  {contentShowsDesktopOnly ? (
                    <div className="flex min-h-0 flex-1 flex-col px-5 pb-5 pt-4">
                      <div className="mb-2 shrink-0 text-xs font-medium text-steel">桌面投屏</div>
                      <div className="flex min-h-0 flex-1 overflow-hidden rounded-lg border border-warm-charcoal bg-abyss">
                        {isOwner ? (
                          <video
                            ref={localVideoRef}
                            className="h-full w-full object-contain"
                            autoPlay
                            playsInline
                            muted
                          />
                        ) : (
                          <video
                            ref={remoteVideoRef}
                            className="h-full w-full object-contain"
                            autoPlay
                            playsInline
                          />
                        )}
                      </div>
                      {!isOwner ? (
                        <p className="mt-2 shrink-0 text-xs text-mint" role="status">
                          正在接收房主桌面画面
                        </p>
                      ) : null}
                    </div>
                  ) : (
                    <div
                      ref={scrollContainerRef}
                      className="min-h-0 flex-1 overflow-auto px-5 py-5"
                    >
                      {!state?.contentMeta ? (
                        <div className="grid gap-2 rounded-lg border border-warm-charcoal bg-abyss p-6">
                          <div className="inline-flex items-center gap-2 text-sm font-semibold text-snow">
                            <Eye size={18} weight="bold" className="text-steel" />
                            暂无内容
                          </div>
                        </div>
                      ) : contentType === 'md' ? (
                        <ContentAnnotations
                          tool={isOwner ? annotateTool : 'pan'}
                          color={annotateColor}
                          strokeWidth={annotateStroke}
                          textFontSize={annotateTextSize}
                          contentVersion={state.contentMeta.version}
                          resetSeq={annotateResetSeq}
                          strokes={annStrokes}
                          texts={annTexts}
                          readOnly={!isOwner}
                          onAnnotationsChange={isOwner ? onAnnotationsChange : undefined}
                        >
                          <MdViewer roomId={roomId} version={state.contentMeta.version} />
                        </ContentAnnotations>
                      ) : (
                        <ContentAnnotations
                          tool={isOwner ? annotateTool : 'pan'}
                          color={annotateColor}
                          strokeWidth={annotateStroke}
                          textFontSize={annotateTextSize}
                          contentVersion={state.contentMeta.version}
                          resetSeq={annotateResetSeq}
                          strokes={annStrokes}
                          texts={annTexts}
                          readOnly={!isOwner}
                          onAnnotationsChange={isOwner ? onAnnotationsChange : undefined}
                        >
                          <PdfViewer url={pdfUrl(roomId)} version={state.contentMeta.version} />
                        </ContentAnnotations>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="grid min-h-0 gap-4">
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
                        {state.shareEnabled ? '房主正在同步文档' : '房主已暂停文档同步'}
                      </div>
                      <div className="mt-1 text-xs leading-relaxed text-parchment">
                        {state.shareEnabled
                          ? 'PDF/Markdown 滚动与标注与房主同步；与桌面投屏无关。'
                          : '文档滚动不再与房主同步；桌面画面在左侧「内容」区显示。'}
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
                  <p className="mt-1 text-xs leading-relaxed text-parchment">
                   
                  </p>
                ) : (
                  <p className="mt-1 text-xs leading-relaxed text-parchment">
                    文档、标注与桌面画面均在左侧「内容」区。
                  </p>
                )}

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

                    <div className="grid gap-2 border-t border-warm-charcoal pt-3">
                      <div className="text-xs font-medium text-steel">桌面投屏</div>
                      <button
                        type="button"
                        onClick={() => {
                          setDesktopError(null)
                          if (isHostSharing) stopDesktopShare()
                          else void startDesktopShare()
                        }}
                        title={isHostSharing ? '结束当前桌面共享后可重新选择' : '在系统对话框中选择要共享的屏幕或窗口'}
                        className={`inline-flex w-full items-center justify-center gap-2 rounded-md border px-4 py-3 text-sm font-semibold transition active:translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50 ${
                          isHostSharing
                            ? 'border-warm-charcoal bg-abyss text-snow hover:bg-black/30'
                            : 'border-signal/50 bg-abyss text-mint hover:bg-black/30'
                        }`}
                      >
                        <Monitor size={18} weight="bold" />
                        选择桌面
                      </button>
                      {desktopError ? (
                        <div className="rounded-lg border border-danger-border bg-danger-bg px-4 py-3 text-xs text-danger">
                          {desktopError}
                        </div>
                      ) : null}
                    </div>

                    <div className="grid gap-2 border-t border-warm-charcoal pt-3">
                      <button
                        type="button"
                        onClick={() => onToggleShare(!state?.shareEnabled)}
                        className="inline-flex w-full items-center rounded-md border border-warm-charcoal bg-carbon px-4 py-3 text-sm font-semibold text-snow transition hover:bg-black/20 active:translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50"
                      >
                        <span className="inline-flex items-center gap-2">
                          {state?.shareEnabled ? (
                            <EyeSlash size={18} weight="bold" />
                          ) : (
                            <Eye size={18} weight="bold" />
                          )}
                          {state?.shareEnabled ? '暂停共享' : '继续共享'}
                        </span>
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
                    </div>

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
                  <div className="mt-4 rounded-lg border border-warm-charcoal bg-abyss p-3 text-sm text-parchment">
                    仅查看；文档、标注与桌面画面在左侧「内容」区。
                  </div>
                )}
              </div>

              <div
                className={`rounded-lg border bg-carbon p-5 shadow-ambient ${
                  isOwner && annotateTool !== 'pan' ? 'border-2 border-signal' : 'border-warm-charcoal'
                }`}
              >
                <div className="text-sm font-medium text-snow">内容标注</div>
                {isOwner ? (
                  <>
                    <p className="mt-1 text-xs leading-relaxed text-parchment">
                      在左侧预览上叠加手写与文字；浏览模式下可正常滚动。标注会同步给观众。切换内容或上传新版本会清空标注。
                    </p>

                    <div className="mt-4 flex flex-wrap gap-2" role="toolbar" aria-label="标注工具">
                      {(
                        [
                          { id: 'pan' as const, label: '浏览', Icon: Cursor },
                          { id: 'draw' as const, label: '手写', Icon: PencilSimple },
                          { id: 'text' as const, label: '文字', Icon: TextT },
                        ] as const
                      ).map(({ id, label, Icon }) => (
                        <button
                          key={id}
                          type="button"
                          onClick={() => setAnnotateTool(id)}
                          className={`inline-flex items-center gap-2 rounded-md border px-3 py-2 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50 ${
                            annotateTool === id
                              ? 'border-signal bg-abyss text-mint shadow-[0_0_12px_rgba(0,217,146,0.18)]'
                              : 'border-warm-charcoal bg-abyss text-snow hover:bg-black/30'
                          }`}
                        >
                          <Icon size={16} weight="bold" />
                          {label}
                        </button>
                      ))}
                    </div>

                    <div className="mt-4">
                      <div className="text-xs font-medium text-steel">颜色</div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {ANNOTATE_COLORS.map((c) => (
                          <button
                            key={c.hex}
                            type="button"
                            title={c.label}
                            onClick={() => setAnnotateColor(c.hex)}
                            className={`h-8 w-8 rounded-md border-2 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50 ${
                              annotateColor === c.hex ? 'border-signal ring-1 ring-signal/40' : 'border-warm-charcoal'
                            }`}
                            style={{ backgroundColor: c.hex }}
                            aria-label={c.label}
                          />
                        ))}
                      </div>
                    </div>

                    <label className="mt-4 grid gap-2">
                      <span className="text-xs font-medium text-steel">笔迹粗细 · {annotateStroke}px</span>
                      <input
                        type="range"
                        min={2}
                        max={16}
                        step={1}
                        value={annotateStroke}
                        onChange={(e) => setAnnotateStroke(Number(e.target.value))}
                        className="h-2 w-full cursor-pointer accent-[#00d992]"
                      />
                    </label>

                    <label className="mt-4 grid gap-2">
                      <span className="text-xs font-medium text-steel">文字大小 · {annotateTextSize}px</span>
                      <input
                        type="range"
                        min={12}
                        max={40}
                        step={1}
                        value={annotateTextSize}
                        onChange={(e) => setAnnotateTextSize(Number(e.target.value))}
                        className="h-2 w-full cursor-pointer accent-[#00d992]"
                      />
                    </label>

                    <button
                      type="button"
                      onClick={() => {
                        setAnnotateResetSeq((n) => n + 1)
                        setOwnerAnnStrokes([])
                        setOwnerAnnTexts([])
                        if (annotationEmitTimerRef.current) {
                          window.clearTimeout(annotationEmitTimerRef.current)
                          annotationEmitTimerRef.current = null
                        }
                        flushAnnotationsToServer([], [])
                      }}
                      className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-md border border-warm-charcoal bg-abyss px-3 py-2.5 text-xs font-semibold text-parchment transition hover:border-danger-border hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50"
                    >
                      <Trash size={16} weight="bold" />
                      清空标注
                    </button>
                  </>
                ) : (
                  <p className="mt-1 text-xs leading-relaxed text-parchment">
                    实时显示房主同步的手写与文字标注；你可滚动预览对照内容。
                  </p>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
