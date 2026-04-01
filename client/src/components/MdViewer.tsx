import { useEffect, useMemo, useState } from 'react'
import MarkdownIt from 'markdown-it'
import { FileText } from '@phosphor-icons/react'

import { getMdContent } from '../lib/api'

type Props = {
  roomId: string
  version: number
}

const md = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true,
})

export function MdViewer(props: Props) {
  const { roomId, version } = props
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState<string | null>(null)
  const [text, setText] = useState<string>('')

  useEffect(() => {
    let cancelled = false
    setStatus('loading')
    setError(null)
    setText('')

    getMdContent({ roomId })
      .then((t) => {
        if (cancelled) return
        setText(t)
        setStatus('ready')
      })
      .catch(() => {
        if (cancelled) return
        setStatus('error')
        setError('Markdown 加载失败')
      })

    return () => {
      cancelled = true
    }
  }, [roomId, version])

  const html = useMemo(() => {
    if (!text) return ''
    return md.render(text)
  }, [text])

  if (status === 'loading') {
    return (
      <div className="grid gap-3">
        <div className="h-9 w-[220px] animate-pulse rounded-2xl bg-white/5" />
        <div className="h-[320px] animate-pulse rounded-3xl bg-white/5" />
      </div>
    )
  }

  if (status === 'error') {
    return (
      <div className="rounded-2xl border border-rose-500/25 bg-rose-500/10 p-5 text-sm text-rose-100">
        {error ?? '加载失败'}
      </div>
    )
  }

  return (
    <div className="grid gap-4">
      <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-zinc-200/75 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
        <FileText size={14} weight="bold" />
        Markdown 已渲染
      </div>

      <article
        className="mdx max-w-none rounded-3xl border border-white/10 bg-black/20 p-6"
        // markdown-it 输出可信：html=false，仍需隔离 class 样式
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  )
}

