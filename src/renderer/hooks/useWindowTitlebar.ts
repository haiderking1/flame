import { useEffect } from "react";
import "../titlebar.css";

type Overlay = EventTarget & { readonly visible: boolean };

export function useWindowTitlebar() {
  useEffect(() => {
    const overlay = (navigator as Navigator & { windowControlsOverlay?: Overlay }).windowControlsOverlay;
    const update = () => {
      document.documentElement.classList.toggle("native-titlebar", overlay?.visible === true);
    };
    update();
    overlay?.addEventListener("geometrychange", update);
    return () => {
      overlay?.removeEventListener("geometrychange", update);
      document.documentElement.classList.remove("native-titlebar");
    };
  }, []);
}
