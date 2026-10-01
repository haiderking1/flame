import { useDesktopUpdate } from "./useDesktopUpdate";
import { useUpdateToast } from "./useUpdateToast";

/** Shows the "downloaded" toast; mounted once, apart from App so update progress never re-renders it. */
export function UpdateToast() {
  useUpdateToast(useDesktopUpdate().state);
  return null;
}
