type BucketChangeCallback = () => void

let currentBucket: number = 0
let onBucketChange: BucketChangeCallback | null = null
let resizeHandler: (() => void) | null = null

export function toBucket(width: number): number {
  return Math.floor(width / 100) * 100
}

function debounce(fn: () => void, ms: number): () => void {
  let timer: ReturnType<typeof setTimeout>
  return () => {
    clearTimeout(timer)
    timer = setTimeout(fn, ms)
  }
}

export function initViewportListener(callback: BucketChangeCallback): void {
  currentBucket = toBucket(window.innerWidth)
  onBucketChange = callback

  resizeHandler = debounce(() => {
    const newBucket = toBucket(window.innerWidth)
    if (newBucket !== currentBucket) {
      currentBucket = newBucket
      onBucketChange?.()
    }
  }, 300)

  window.addEventListener('resize', resizeHandler)
}

export function destroyViewportListener(): void {
  if (resizeHandler) {
    window.removeEventListener('resize', resizeHandler)
    resizeHandler = null
  }
  onBucketChange = null
}
