let currentToast: HTMLElement | null = null
let currentTimer: ReturnType<typeof setTimeout> | null = null

export function showToast(container: HTMLElement, message: string, duration = 3000): void {
  hideToast()

  const toast = document.createElement('div')
  toast.className = 'remarq-toast'
  toast.textContent = message
  container.appendChild(toast)
  currentToast = toast

  currentTimer = setTimeout(() => {
    if (currentToast) {
      currentToast.classList.add('remarq-toast-fade')
      setTimeout(() => hideToast(), 300)
    }
  }, duration)
}

export function hideToast(): void {
  if (currentTimer) {
    clearTimeout(currentTimer)
    currentTimer = null
  }
  if (currentToast) {
    currentToast.remove()
    currentToast = null
  }
}
