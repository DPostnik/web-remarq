/**
 * Public subpath entry: @web-remarq/unplugin/transform
 *
 * Exposes the raw transforms and the include/exclude filter so tooling (notably
 * `@web-remarq/cli doctor`) can verify that source stamping works against the
 * user's own files - with the user's own include option - without booting a
 * bundler.
 */
export { transformJSX, transformVueSFC } from './transform'
export { createFilter, DEFAULT_EXCLUDE, DEFAULT_INCLUDE } from './filter'
