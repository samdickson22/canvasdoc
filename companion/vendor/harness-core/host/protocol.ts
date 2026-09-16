import { HARNESS_PROTOCOL } from "../protocol.ts";

/** The harness protocol as a host registers it: main plus the interest and context subprotocols. */
export const HARNESS_HOST_PROTOCOL = {
  ...HARNESS_PROTOCOL,
  subprotocols: [
    { name: "interest", record: "ephemeral" },
    { name: "context", record: "ephemeral" },
  ],
} as const;
