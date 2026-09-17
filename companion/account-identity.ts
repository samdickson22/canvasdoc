import { readFile } from "node:fs/promises";
import path from "node:path";
import { atomicJson } from "./codex.ts";

export class IdentityError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

function validAccount(account: unknown): account is string {
  if (typeof account !== "string") return false;
  const match = /^canvasdoc:v1:(https?:\/\/.+):([^:]+)$/.exec(account);
  if (!match) return false;
  try {
    return new URL(match[1]).origin === match[1];
  } catch {
    return false;
  }
}

/** A folder and its persistent agent history belong to one Canvas account. */
export class WorkspaceAccount {
  private account?: string;
  private file: string;
  private workspaceId: string;
  constructor(stateDir: string, workspaceId: string) {
    this.workspaceId = workspaceId;
    this.file = path.join(stateDir, "account.json");
  }
  async load() {
    try {
      const saved = JSON.parse(await readFile(this.file, "utf8"));
      if (
        saved.version !== 1 ||
        saved.workspaceId !== this.workspaceId ||
        !validAccount(saved.account)
      )
        throw new Error(
          "Workspace account identity is invalid. Restore the original account binding; do not reset this folder.",
        );
      this.account = saved.account;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  async admit(
    account: unknown,
    expectedWorkspaceId: unknown,
    unboundHasWork: boolean,
    origin: string,
  ) {
    if (!validAccount(account))
      throw new IdentityError(
        "ACCOUNT_REQUIRED",
        "Reconnect from a signed-in Canvas account.",
      );
    if (
      account.slice("canvasdoc:v1:".length, account.lastIndexOf(":")) !== origin
    )
      throw new IdentityError(
        "ACCOUNT_MISMATCH",
        "The Canvas account does not match this connection origin.",
      );
    if (
      expectedWorkspaceId !== undefined &&
      expectedWorkspaceId !== this.workspaceId
    )
      throw new IdentityError(
        "WORKSPACE_MISMATCH",
        "This is a different Canvasdoc folder. Reconnect the original folder.",
      );
    if (this.account && account !== this.account)
      throw new IdentityError(
        "ACCOUNT_MISMATCH",
        "This Canvasdoc folder belongs to a different Canvas account.",
      );
    if (!this.account) {
      if (unboundHasWork)
        throw new IdentityError(
          "ACCOUNT_BINDING_REQUIRED",
          "This existing Canvasdoc folder has no verified Canvas account binding. Select a new Canvasdoc folder for this account.",
        );
      await atomicJson(this.file, {
        version: 1,
        workspaceId: this.workspaceId,
        account,
      });
      this.account = account;
    }
    return account;
  }
}
