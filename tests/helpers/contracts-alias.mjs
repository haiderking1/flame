/**
 * Node module resolve hook for importing renderer TypeScript directly: maps the `@contracts/x` alias to
 * src/contracts/x.ts, and resolves extensionless relative imports between renderer .ts files, as Vite does.
 */
const contracts = new URL('../../src/contracts/', import.meta.url);
export async function resolve(specifier, context, next) {
  if (specifier.startsWith('@contracts/')) return next(new URL(`${specifier.slice('@contracts/'.length)}.ts`, contracts).href, context);
  if (/^\.\.?\//.test(specifier) && !/\.[cm]?[jt]sx?$/.test(specifier) && context.parentURL?.endsWith('.ts')) return next(`${specifier}.ts`, context);
  return next(specifier, context);
}
