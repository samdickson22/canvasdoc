import { createContext } from "react";
// Keep library popovers in the same styled shadow root as the Canvasdoc thread.
export const PortalContainerContext = createContext<HTMLElement | null>(null);
