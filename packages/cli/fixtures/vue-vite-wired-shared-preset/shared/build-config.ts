import remarq from '@web-remarq/unplugin/vite'

/** Shared preset used by every app in the monorepo - registers the remarq plugin. */
export function remarqPreset() {
  return remarq()
}
