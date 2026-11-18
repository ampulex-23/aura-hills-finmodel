// Слайды презентации для deck-обновления.
// pdf → JPEG-блобы по страницам через pdfjs (рендер в браузере,
// сервер остаётся zero-dep); пачка картинок идёт как есть,
// отсортированная по имени натурально (slide-2 < slide-10).

export interface SlideBlob {
  ext: 'jpg' | 'png' | 'webp'
  blob: Blob
}

const TARGET_W = 1920 // ширина слайда в px
const JPEG_Q = 0.85

export async function pdfToSlideBlobs(
  file: File,
  onProgress?: (done: number, total: number) => void,
): Promise<SlideBlob[]> {
  const pdfjs = await import('pdfjs-dist')
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.mjs',
    import.meta.url,
  ).toString()
  const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise
  const out: SlideBlob[] = []
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i)
    const base = page.getViewport({ scale: 1 })
    const scale = TARGET_W / base.width
    const vp = page.getViewport({ scale })
    const canvas = document.createElement('canvas')
    canvas.width = Math.ceil(vp.width)
    canvas.height = Math.ceil(vp.height)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('canvas 2d unavailable')
    await page.render({ canvasContext: ctx, viewport: vp }).promise
    const blob = await new Promise<Blob>((res, rej) =>
      canvas.toBlob(
        (b) => (b ? res(b) : rej(new Error('canvas.toBlob failed'))),
        'image/jpeg',
        JPEG_Q,
      ),
    )
    out.push({ ext: 'jpg', blob })
    onProgress?.(i, doc.numPages)
  }
  return out
}

const IMG_EXT: Record<string, SlideBlob['ext']> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}

/** Пачка файлов-картинок → слайды (естественный порядок по имени). */
export function filesToSlideBlobs(files: File[]): SlideBlob[] {
  return files
    .filter((f) => IMG_EXT[f.type])
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
    .map((f) => ({ ext: IMG_EXT[f.type], blob: f }))
}
