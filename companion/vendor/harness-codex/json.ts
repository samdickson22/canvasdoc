const checkNumber = (_key: string, value: unknown) => {
  if (typeof value === "bigint")
    throw new Error("codex: RPC integers must be JSON numbers");
  if (
    typeof value === "number" &&
    (!Number.isFinite(value) ||
      (Number.isInteger(value) && !Number.isSafeInteger(value)))
  )
    throw new Error("codex: RPC number is outside the supported JSON range");
  return value;
};

export const encodeMessage = (message: unknown): string => {
  const result = JSON.stringify(message, checkNumber);
  if (result === undefined) throw new Error("codex: RPC message is not JSON");
  return result;
};

export const decodeMessage = (message: string): unknown =>
  JSON.parse(message, checkNumber);
