const THEME_KEY = 'remarq:theme'

export type Theme = 'light' | 'dark'

export class ThemeManager {
  container: HTMLElement
  private theme: Theme

  constructor(parent: HTMLElement, initialTheme?: Theme) {
    const persisted = this.loadTheme()
    this.theme = initialTheme ?? persisted ?? 'light'

    this.container = document.createElement('div')
    this.container.setAttribute('data-remarq-theme', this.theme)
    parent.appendChild(this.container)

    this.persist()
  }

  getTheme(): Theme {
    return this.theme
  }

  setTheme(theme: Theme): void {
    this.theme = theme
    this.container.setAttribute('data-remarq-theme', theme)
    this.persist()
  }

  toggle(): void {
    this.setTheme(this.theme === 'light' ? 'dark' : 'light')
  }

  destroy(): void {
    this.container.remove()
  }

  private persist(): void {
    try {
      localStorage.setItem(THEME_KEY, this.theme)
    } catch {
      // ignore
    }
  }

  private loadTheme(): Theme | null {
    try {
      const value = localStorage.getItem(THEME_KEY)
      if (value === 'light' || value === 'dark') return value
    } catch {
      // ignore
    }
    return null
  }
}
