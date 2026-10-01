import { RESTING_IMAGE_LIMIT } from "./restingLogic";

/** Beside a resting draft's first images, how many more it has; choosing it brings the full composer back. */
export function RestingImageCount({ count, onExpand }: { count: number; onExpand(): void }) {
  const more = count - RESTING_IMAGE_LIMIT;
  if (more <= 0) return null;
  return <button type="button" className="composer-resting__more" aria-label={`Show all ${count} images`} title={`Show all ${count} images`} onClick={onExpand}>+{more}</button>;
}
