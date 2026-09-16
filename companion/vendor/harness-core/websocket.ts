import { StatewireWebsocket } from "statewire";
import type { StatewireClient } from "statewire";
import type { Harness } from "./harness.ts";

/** A WebSocket transport for `useHarness`: `useHarness({ transport: HarnessWebsocket({ url }) })`. */
export const HarnessWebsocket = (
  options: HarnessWebsocket.Options,
): Harness.Transport => StatewireWebsocket(options);

export namespace HarnessWebsocket {
  export type Options = StatewireClient.WebsocketOptions;
}
