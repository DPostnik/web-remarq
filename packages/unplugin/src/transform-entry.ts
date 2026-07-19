/**
 * Public subpath entry: @web-remarq/unplugin/transform
 *
 * Exposes the raw transforms so tooling (notably `@web-remarq/cli doctor`) can
 * verify that source stamping works against the user's own files, without
 * booting a bundler.
 */
export { transformJSX, transformVueSFC } from './transform'
