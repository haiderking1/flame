/** Node module resolve hook mapping the renderer's `@contracts/x` alias to src/contracts/x.ts. */
const contracts = new URL('../../src/contracts/', import.meta.url);
export async function resolve(specifier, context, next) {
  if (specifier.startsWith('@contracts/')) return next(new URL(`${specifier.slice('@contracts/'.length)}.ts`, contracts).href, context);
  return next(specifier, context);
}
