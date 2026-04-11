import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { GlobalWorkerOptions, getDocument, type PDFDocumentProxy } from 'pdfjs-dist'
import workerSrc from 'pdfjs-dist/build/pdf.worker.mjs?url'

GlobalWorkerOptions.workerSrc = workerSrc

type Props = {
  url: string
  version: number
}

type PageCanvas = { pageNumber: number; width: number; height: number; ref: HTMLCanvasElement | null }

export function PdfViewer(props: Props) {
  const { url, version } = props
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState<string | null>(null)

  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null)
  const [pages, setPages] = useState<PageCanvas[]>([])
  const rootRef = useRef<HTMLDivElement | null>(null)
  const canvasByPageRef = useRef<Map<number, HTMLCanvasElement | null>>(new Map())
  const [containerWidth, setContainerWidth] = useState(0)

  const cacheKey = useMemo(() => `${url}?v=${version}`, [url, version])

  useEffect(() => {
    let cancelled = false
    setStatus('loading')
    setError(null)
    setDoc(null)
    setPages([])

    const loadingTask = getDocument({
      url: cacheKey,
      withCredentials: false,
    })

    loadingTask.promise
      .then((pdf) => {
        if (cancelled) return
        setDoc(pdf)
        const nextPages: PageCanvas[] = Array.from({ length: pdf.numPages }, (_, idx) => ({
          pageNumber: idx + 1,
          width: 0,
          height: 0,
          ref: null,
        }))
        setPages(nextPages)
        setStatus('ready')
      })
      .catch(() => {
        if (cancelled) return
        setStatus('error')
        setError('PDF 加载失败')
      })

    return () => {
      cancelled = true
      void loadingTask.destroy()
    }
  }, [cacheKey])

  useLayoutEffect(() => {
    const el = rootRef.current
    if (!el || status !== 'ready') return

    const measure = () => {
      const w = el.clientWidth
      setContainerWidth((prev) => (prev === w ? prev : w))
    }

    measure()
    const ro = new ResizeObserver(() => {
      measure()
    })
    ro.observe(el)
    return () => {
      ro.disconnect()
    }
  }, [status, doc, pages.length])

  useEffect(() => {
    if (!doc || status !== 'ready') return
    if (containerWidth <= 0) return

    let cancelled = false
    const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1))
    const targetCssWidth = Math.max(200, Math.min(980, containerWidth))

    ;(async () => {
      for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
        if (cancelled) return
        const page = await doc.getPage(pageNumber)
        if (cancelled) return

        const viewport0 = page.getViewport({ scale: 1 })
        const scale = targetCssWidth / viewport0.width
        const viewport = page.getViewport({ scale })

        setPages((prev) =>
          prev.map((p) =>
            p.pageNumber === pageNumber ? { ...p, width: viewport.width, height: viewport.height } : p,
          ),
        )

        const canvas = canvasByPageRef.current.get(pageNumber)
        if (!canvas) continue
        const ctx = canvas.getContext('2d', { alpha: false })
        if (!ctx) continue

        canvas.width = Math.floor(viewport.width * dpr)
        canvas.height = Math.floor(viewport.height * dpr)
        canvas.style.width = `${Math.floor(viewport.width)}px`
        canvas.style.height = `${Math.floor(viewport.height)}px`

        ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
        ctx.imageSmoothingEnabled = true

        await page.render({ canvasContext: ctx, viewport }).promise
      }
    })().catch(() => {
      setStatus('error')
      setError('PDF 渲染失败')
    })

    return () => {
      cancelled = true
    }
  }, [doc, version, url, status, containerWidth])

  if (status === 'loading') {
    return (
      <div className="h-[420px] w-full animate-pulse rounded-lg bg-carbon ring-1 ring-warm-charcoal" />
    )
  }

  if (status === 'error') {
    return (
      <div className="rounded-lg border border-danger-border bg-danger-bg p-5 text-sm text-danger">
        {error ?? '加载失败'}
      </div>
    )
  }

  return (
    <div ref={rootRef} className="grid w-full min-w-0 gap-5">
      {pages.map((p) => (
        <div key={p.pageNumber} className="grid w-full min-w-0 justify-center">
          <canvas
            ref={(el) => {
              p.ref = el
              if (el) canvasByPageRef.current.set(p.pageNumber, el)
              else canvasByPageRef.current.delete(p.pageNumber)
            }}
            className="max-w-full rounded-lg bg-white shadow-dramatic"
          />
        </div>
      ))}
    </div>
  )
}

