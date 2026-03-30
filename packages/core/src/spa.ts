type RouteChangeListener = (route: string) => void

export class RouteObserver {
  private listeners: Set<RouteChangeListener> = new Set()
  private originalPushState: typeof history.pushState
  private originalReplaceState: typeof history.replaceState
  private boundOnPopState: () => void
  private boundOnHashChange: () => void

  constructor() {
    this.originalPushState = history.pushState.bind(history)
    this.originalReplaceState = history.replaceState.bind(history)
    this.boundOnPopState = () => this.notify()
    this.boundOnHashChange = () => this.notify()

    this.patchHistory()

    window.addEventListener('popstate', this.boundOnPopState)
    window.addEventListener('hashchange', this.boundOnHashChange)
  }

  currentRoute(): string {
    return location.pathname + location.hash
  }

  onChange(listener: RouteChangeListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  destroy(): void {
    window.removeEventListener('popstate', this.boundOnPopState)
    window.removeEventListener('hashchange', this.boundOnHashChange)
    history.pushState = this.originalPushState
    history.replaceState = this.originalReplaceState
    this.listeners.clear()
  }

  private notify(): void {
    const route = this.currentRoute()
    for (const listener of this.listeners) {
      listener(route)
    }
  }

  private patchHistory(): void {
    const self = this

    history.pushState = function (...args: Parameters<typeof history.pushState>) {
      self.originalPushState.apply(this, args)
      self.notify()
    }

    history.replaceState = function (...args: Parameters<typeof history.replaceState>) {
      self.originalReplaceState.apply(this, args)
      self.notify()
    }
  }
}
