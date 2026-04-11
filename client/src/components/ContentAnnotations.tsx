import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

import type { RoomAnnotationStroke, RoomAnnotationText } from '../lib/api'

export type AnnotateTool = 'pan' | 'draw' | 'text'

export type { RoomAnnotationStroke, RoomAnnotationText }

const DEFAULT_TEXT_FONT_PX = 14

function textFontPx(t: RoomAnnotationText): number {
  const n = t.fontSize
  if (typeof n === 'number' && n >= 8 && n <= 96) return n
  return DEFAULT_TEXT_FONT_PX
}

type Props = {
  children: React.ReactNode
  tool: AnnotateTool
  color: string
  strokeWidth: number
  /** 新建文字标注的字号（px） */
  textFontSize: number
  contentVersion: number
  /** 递增则清空本地草稿（与内容版本独立） */
  resetSeq?: number
  strokes: RoomAnnotationStroke[]
  texts: RoomAnnotationText[]
  /** 观众只读；房主编辑时必传 */
  readOnly?: boolean
  onAnnotationsChange?: (next: {
    strokes: RoomAnnotationStroke[]
    texts: RoomAnnotationText[]
  }) => void
}

/** 兼容 HTTP / 旧环境（无 crypto.randomUUID） */
function newAnnotationId(): string {
  const c = typeof globalThis !== 'undefined' ? globalThis.crypto : undefined
  if (c?.randomUUID) return c.randomUUID()
  if (c?.getRandomValues) {
    const buf = new Uint8Array(16)
    c.getRandomValues(buf)
    buf[6] = (buf[6] & 0x0f) | 0x40
    buf[8] = (buf[8] & 0x3f) | 0x80
    const h = [...buf].map((b) => b.toString(16).padStart(2, '0')).join('')
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
  }
  return `a-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`
}

/** 屏幕坐标 → SVG 内归一化坐标，与 getScreenCTM 一致，避免 absolute 参照错祖先时的偏移 */
function clientToSvgNormalized(
  svg: SVGSVGElement,
  clientX: number,
  clientY: number,
): [number, number] {
  const w = svg.clientWidth || 1
  const h = svg.clientHeight || 1
  try {
    const pt = svg.createSVGPoint()
    pt.x = clientX
    pt.y = clientY
    const ctm = svg.getScreenCTM()
    if (ctm) {
      const loc = pt.matrixTransform(ctm.inverse())
      return [
        Math.max(0, Math.min(1, loc.x / w)),
        Math.max(0, Math.min(1, loc.y / h)),
      ]
    }
  } catch {
    // ignore
  }
  const r = svg.getBoundingClientRect()
  const nx = r.width > 0 ? (clientX - r.left) / r.width : 0
  const ny = r.height > 0 ? (clientY - r.top) / r.height : 0
  return [Math.max(0, Math.min(1, nx)), Math.max(0, Math.min(1, ny))]
}

export function ContentAnnotations(props: Props) {
  const {
    children,
    tool,
    color,
    strokeWidth,
    textFontSize,
    contentVersion,
    resetSeq = 0,
    strokes,
    texts,
    readOnly = false,
    onAnnotationsChange,
  } = props

  const wrapRef = useRef<HTMLDivElement | null>(null)
  const layerRef = useRef<HTMLDivElement | null>(null)
  const svgRef = useRef<SVGSVGElement | null>(null)
  const [size, setSize] = useState({ w: 1, h: 1 })
  const [draft, setDraft] = useState<RoomAnnotationStroke | null>(null)
  const draftRef = useRef<RoomAnnotationStroke | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const suppressTextClickUntilRef = useRef(0)
  const strokesRef = useRef(strokes)
  const textsRef = useRef(texts)
  useEffect(() => {
    strokesRef.current = strokes
    textsRef.current = texts
  }, [strokes, texts])

  const pushAnnotations = useCallback(
    (next: { strokes: RoomAnnotationStroke[]; texts: RoomAnnotationText[] }) => {
      onAnnotationsChange?.(next)
    },
    [onAnnotationsChange],
  )

  useEffect(() => {
    setDraft(null)
    draftRef.current = null
    setEditingId(null)
    setEditValue('')
  }, [contentVersion, resetSeq])

  useLayoutEffect(() => {
    const el = svgRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      setSize({ w: el.clientWidth || 1, h: el.clientHeight || 1 })
    })
    ro.observe(el)
    setSize({ w: el.clientWidth || 1, h: el.clientHeight || 1 })
    return () => ro.disconnect()
  }, [contentVersion])

  const drawingRef = useRef(false)

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (readOnly || tool !== 'draw') return
      const layer = layerRef.current
      const svg = svgRef.current
      if (!layer || !svg) return
      e.preventDefault()
      layer.setPointerCapture(e.pointerId)
      drawingRef.current = true
      const [nx, ny] = clientToSvgNormalized(svg, e.clientX, e.clientY)
      const next: RoomAnnotationStroke = {
        id: newAnnotationId(),
        points: [[nx, ny]],
        color,
        width: strokeWidth,
      }
      draftRef.current = next
      setDraft(next)
    },
    [readOnly, tool, color, strokeWidth],
  )

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (readOnly || tool !== 'draw' || !drawingRef.current) return
      const cur = draftRef.current
      if (!cur) return
      const layer = layerRef.current
      const svg = svgRef.current
      if (!layer || !svg) return
      e.preventDefault()
      const [nx, ny] = clientToSvgNormalized(svg, e.clientX, e.clientY)
      const merged: RoomAnnotationStroke = { ...cur, points: [...cur.points, [nx, ny]] }
      draftRef.current = merged
      setDraft(merged)
    },
    [readOnly, tool],
  )

  const endDraw = useCallback(() => {
    if (!drawingRef.current) return
    drawingRef.current = false
    const d = draftRef.current
    draftRef.current = null
    setDraft(null)
    if (d && d.points.length > 0) {
      suppressTextClickUntilRef.current = Date.now() + 400
      let finalStroke = d
      if (d.points.length === 1) {
        const p = d.points[0]
        finalStroke = { ...d, points: [p, p] }
      }
      pushAnnotations({
        strokes: [...strokesRef.current, finalStroke],
        texts: textsRef.current,
      })
    }
  }, [pushAnnotations])

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (readOnly || tool !== 'draw') return
      try {
        layerRef.current?.releasePointerCapture(e.pointerId)
      } catch {
        // ignore
      }
      endDraw()
    },
    [readOnly, tool, endDraw],
  )

  const onClickText = useCallback(
    (e: React.MouseEvent) => {
      if (readOnly || tool !== 'text') return
      if (Date.now() < suppressTextClickUntilRef.current) return
      const t = e.target as HTMLElement
      if (t.closest('[data-annotation-ui]')) return
      const layer = layerRef.current
      const svg = svgRef.current
      if (!layer || !svg) return
      e.preventDefault()
      e.stopPropagation()
      const [nx, ny] = clientToSvgNormalized(svg, e.clientX, e.clientY)
      const id = newAnnotationId()
      pushAnnotations({
        strokes: strokesRef.current,
        texts: [...textsRef.current, { id, x: nx, y: ny, text: '', color, fontSize: textFontSize }],
      })
      setEditingId(id)
      setEditValue('')
    },
    [readOnly, tool, color, textFontSize, pushAnnotations],
  )

  const commitEdit = useCallback(() => {
    if (!editingId) return
    const v = editValue.trim()
    const nextTexts = textsRef.current
      .map((t) => (t.id === editingId ? { ...t, text: v } : t))
      .filter((t) => t.text.length > 0)
    pushAnnotations({ strokes: strokesRef.current, texts: nextTexts })
    setEditingId(null)
    setEditValue('')
  }, [editingId, editValue, pushAnnotations])

  const pointerNone = readOnly || tool === 'pan'

  return (
    <div ref={wrapRef} className="grid w-full [grid-template-areas:'stack']">
      <div className="min-w-0 [grid-area:stack]">{children}</div>
      <div
        ref={layerRef}
        className={`relative isolate [grid-area:stack] z-[5] min-h-full min-w-full self-stretch justify-self-stretch ${
          pointerNone ? 'pointer-events-none' : ''
        }`}
        style={{
          touchAction: tool === 'draw' && !readOnly ? 'none' : undefined,
          cursor:
            readOnly || tool === 'pan'
              ? 'default'
              : tool === 'draw'
                ? 'crosshair'
                : 'text',
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onClick={onClickText}
      >
        <svg
          ref={svgRef}
          className="absolute left-0 top-0 h-full w-full touch-none"
          style={{ pointerEvents: pointerNone ? 'none' : 'auto' }}
          aria-hidden
        >
          {strokes.map((s) => (
            <polyline
              key={s.id}
              fill="none"
              stroke={s.color}
              strokeWidth={s.width}
              strokeLinecap="round"
              strokeLinejoin="round"
              points={s.points.map(([nx, ny]) => `${nx * size.w},${ny * size.h}`).join(' ')}
            />
          ))}
          {draft && draft.points.length > 0 ? (
            <polyline
              fill="none"
              stroke={draft.color}
              strokeWidth={draft.width}
              strokeLinecap="round"
              strokeLinejoin="round"
              points={draft.points.map(([nx, ny]) => `${nx * size.w},${ny * size.h}`).join(' ')}
            />
          ) : null}
        </svg>

        {texts.map((t) => (
          <div
            key={t.id}
            data-annotation-ui
            className="absolute z-[6] min-w-[120px] max-w-[min(320px,calc(100%-8px))]"
            style={{
              left: `${t.x * 100}%`,
              top: `${t.y * 100}%`,
              transform: 'translate(0, -100%)',
            }}
          >
            {!readOnly && editingId === t.id ? (
              <textarea
                data-annotation-ui
                autoFocus
                rows={2}
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onBlur={commitEdit}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    pushAnnotations({
                      strokes: strokesRef.current,
                      texts: textsRef.current.filter((x) => x.id !== t.id),
                    })
                    setEditingId(null)
                    setEditValue('')
                  }
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    commitEdit()
                  }
                }}
                className="w-full resize-y rounded-md border border-signal bg-transparent px-2 py-1.5 outline-none ring-0 placeholder:text-steel/80 focus-visible:ring-2 focus-visible:ring-blue-500/50"
                style={{ color: t.color, fontSize: textFontPx(t) }}
                placeholder="输入标注…"
              />
            ) : (
              <div
                role={readOnly ? undefined : 'button'}
                data-annotation-ui
                className={`rounded-md border border-transparent bg-transparent px-0.5 py-0 text-left ${
                  readOnly ? '' : 'cursor-pointer transition hover:border-warm-charcoal/40'
                }`}
                style={{ color: t.color, fontSize: textFontPx(t) }}
                onClick={
                  readOnly
                    ? undefined
                    : (e) => {
                        e.stopPropagation()
                        setEditingId(t.id)
                        setEditValue(t.text)
                      }
                }
              >
                {t.text || (readOnly ? '' : '（空）')}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
