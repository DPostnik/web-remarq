const STYLES_ID = 'data-remarq-styles'

const CSS = `
[data-remarq-theme="light"] {
  --remarq-bg: #ffffff;
  --remarq-bg-secondary: #f5f5f5;
  --remarq-text: #1a1a1a;
  --remarq-text-secondary: #666666;
  --remarq-border: #e2e8f0;
  --remarq-accent: #3b82f6;
  --remarq-pending: #f97316;
  --remarq-resolved: #22c55e;
  --remarq-overlay: rgba(59, 130, 246, 0.15);
  --remarq-shadow: 0 4px 12px rgba(0,0,0,0.15);
}

[data-remarq-theme="dark"] {
  --remarq-bg: #1e1e1e;
  --remarq-bg-secondary: #2a2a2a;
  --remarq-text: #e5e5e5;
  --remarq-text-secondary: #999999;
  --remarq-border: #333333;
  --remarq-accent: #60a5fa;
  --remarq-pending: #fb923c;
  --remarq-resolved: #4ade80;
  --remarq-overlay: rgba(96, 165, 250, 0.15);
  --remarq-shadow: 0 4px 12px rgba(0,0,0,0.4);
}

.remarq-toolbar {
  position: fixed;
  bottom: 16px;
  right: 16px;
  z-index: 2147483647;
  display: flex;
  gap: 4px;
  padding: 8px;
  background: var(--remarq-bg);
  border: 1px solid var(--remarq-border);
  border-radius: 8px;
  box-shadow: var(--remarq-shadow);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  font-size: 13px;
  color: var(--remarq-text);
}

.remarq-toolbar.remarq-minimized { padding: 4px; }

.remarq-toolbar-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--remarq-text);
  cursor: pointer;
  position: relative;
}

.remarq-toolbar-btn:hover { background: var(--remarq-bg-secondary); }
.remarq-toolbar-btn.remarq-active { background: var(--remarq-accent); color: #ffffff; }

.remarq-badge {
  position: absolute;
  top: -4px;
  right: -4px;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  border-radius: 8px;
  background: var(--remarq-pending);
  color: #ffffff;
  font-size: 10px;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
}

.remarq-overlay {
  position: fixed;
  pointer-events: none;
  background: var(--remarq-overlay);
  border: 2px solid var(--remarq-accent);
  border-radius: 2px;
  z-index: 2147483646;
  transition: all 0.05s ease-out;
}

.remarq-tooltip {
  position: fixed;
  z-index: 2147483647;
  padding: 4px 8px;
  background: var(--remarq-bg);
  border: 1px solid var(--remarq-border);
  border-radius: 4px;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  font-size: 12px;
  color: var(--remarq-text);
  box-shadow: var(--remarq-shadow);
  pointer-events: none;
  white-space: nowrap;
  max-width: 300px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.remarq-marker {
  position: absolute;
  z-index: 2147483645;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  font-size: 11px;
  font-weight: 700;
  color: #ffffff;
  cursor: pointer;
  box-shadow: 0 2px 4px rgba(0,0,0,0.2);
  transition: transform 0.1s ease;
}

.remarq-marker:hover { transform: scale(1.2); }
.remarq-marker[data-status="pending"] { background: var(--remarq-pending); }
.remarq-marker[data-status="resolved"] { background: var(--remarq-resolved); opacity: 0.7; }

.remarq-popup {
  position: absolute;
  z-index: 2147483647;
  width: 300px;
  background: var(--remarq-bg);
  border: 1px solid var(--remarq-border);
  border-radius: 8px;
  box-shadow: var(--remarq-shadow);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  font-size: 13px;
  color: var(--remarq-text);
}

.remarq-popup-header {
  padding: 8px 12px;
  border-bottom: 1px solid var(--remarq-border);
  font-size: 12px;
  color: var(--remarq-text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.remarq-popup-body { padding: 12px; }

.remarq-popup textarea {
  width: 100%;
  min-height: 60px;
  padding: 8px;
  border: 1px solid var(--remarq-border);
  border-radius: 4px;
  background: var(--remarq-bg-secondary);
  color: var(--remarq-text);
  font-family: inherit;
  font-size: 13px;
  resize: vertical;
  box-sizing: border-box;
}

.remarq-popup textarea:focus { outline: none; border-color: var(--remarq-accent); }

.remarq-popup-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 8px 12px;
  border-top: 1px solid var(--remarq-border);
}

.remarq-popup-actions button {
  padding: 4px 12px;
  border: 1px solid var(--remarq-border);
  border-radius: 4px;
  background: var(--remarq-bg);
  color: var(--remarq-text);
  cursor: pointer;
  font-size: 12px;
}

.remarq-popup-actions button.remarq-primary {
  background: var(--remarq-accent);
  border-color: var(--remarq-accent);
  color: #ffffff;
}

.remarq-detached-panel {
  position: fixed;
  bottom: 60px;
  right: 16px;
  z-index: 2147483646;
  width: 280px;
  max-height: 300px;
  overflow-y: auto;
  background: var(--remarq-bg);
  border: 1px solid var(--remarq-border);
  border-radius: 8px;
  box-shadow: var(--remarq-shadow);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  font-size: 13px;
  color: var(--remarq-text);
}

.remarq-detached-header {
  padding: 8px 12px;
  border-bottom: 1px solid var(--remarq-border);
  font-weight: 600;
  font-size: 12px;
  color: var(--remarq-text-secondary);
}

.remarq-detached-item {
  padding: 8px 12px;
  border-bottom: 1px solid var(--remarq-border);
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 8px;
}

.remarq-detached-item:last-child { border-bottom: none; }
.remarq-detached-info { flex: 1; min-width: 0; }
.remarq-detached-comment { margin-bottom: 4px; }

.remarq-detached-element {
  font-size: 11px;
  color: var(--remarq-text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.remarq-detached-delete {
  border: none;
  background: none;
  color: var(--remarq-text-secondary);
  cursor: pointer;
  padding: 2px;
  font-size: 14px;
  line-height: 1;
  flex-shrink: 0;
}

.remarq-detached-delete:hover { color: #ef4444; }

.remarq-export-menu {
  position: absolute;
  bottom: 100%;
  right: 0;
  margin-bottom: 4px;
  background: var(--remarq-bg);
  border: 1px solid var(--remarq-border);
  border-radius: 6px;
  box-shadow: var(--remarq-shadow);
  overflow: hidden;
}

.remarq-export-menu button {
  display: block;
  width: 100%;
  padding: 8px 16px;
  border: none;
  background: transparent;
  color: var(--remarq-text);
  cursor: pointer;
  font-size: 12px;
  text-align: left;
  white-space: nowrap;
}

.remarq-export-menu button:hover { background: var(--remarq-bg-secondary); }

.remarq-detached-header + .remarq-detached-header {
  border-top: 2px solid var(--remarq-border);
}

.remarq-detached-item[style*="cursor"]:hover {
  background: var(--remarq-bg-secondary);
}

.remarq-toast {
  position: fixed;
  bottom: 60px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 2147483647;
  padding: 8px 16px;
  background: var(--remarq-bg);
  border: 1px solid var(--remarq-border);
  border-radius: 6px;
  box-shadow: var(--remarq-shadow);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  font-size: 13px;
  color: var(--remarq-text);
  transition: opacity 0.3s ease;
}

.remarq-toast-fade {
  opacity: 0;
}
`

export function injectStyles(): void {
  if (document.querySelector(`style[${STYLES_ID}]`)) return

  try {
    const style = document.createElement('style')
    style.setAttribute(STYLES_ID, '')
    style.textContent = CSS
    document.head.appendChild(style)
  } catch {
    // CSP fallback: try blob URL via <link>
    try {
      const blob = new Blob([CSS], { type: 'text/css' })
      const link = document.createElement('link')
      link.rel = 'stylesheet'
      link.href = URL.createObjectURL(blob)
      link.setAttribute(STYLES_ID, '')
      document.head.appendChild(link)
    } catch {
      console.warn('[web-remarq] Could not inject styles')
    }
  }
}

export function removeStyles(): void {
  const el = document.querySelector(`[${STYLES_ID}]`)
  el?.remove()
}
