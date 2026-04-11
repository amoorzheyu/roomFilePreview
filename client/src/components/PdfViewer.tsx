import { useEffect, useMemo, useRef, useState } from 'react'
import { FilePdf } from '@phosphor-icons/react'
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

  useEffect(() => {
    if (!doc) return
    if (!rootRef.current) return

    let cancelled = false
    const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1))
    const targetCssWidth = Math.min(980, rootRef.current.clientWidth)

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

        const canvas = pages.find((p) => p.pageNumber === pageNumber)?.ref
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, version, url])

  if (status === 'loading') {
    return (
      <div className="grid gap-3">
        <div className="h-9 w-[220px] animate-pulse rounded-lg bg-carbon ring-1 ring-warm-charcoal" />
        <div className="h-[420px] animate-pulse rounded-lg bg-carbon ring-1 ring-warm-charcoal" />
      </div>
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
    <div ref={rootRef} className="grid gap-5">
      <div className="inline-flex items-center gap-2 rounded-full border border-warm-charcoal bg-carbon px-3 py-1 text-xs text-parchment shadow-ambient">
        <FilePdf size={14} weight="bold" className="text-steel" />
        共 {doc?.numPages ?? 0} 页
      </div>

      <div className="grid gap-5">
        {pages.map((p) => (
          <div key={p.pageNumber} className="grid justify-center">
            <canvas
              ref={(el) => {
                p.ref = el
              }}
              className="rounded-lg bg-white shadow-dramatic"
            />
          </div>
        ))}
      </div>
    </div>
  )
}

