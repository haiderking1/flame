import type { Credential } from "./credentials.js";

/** One browser sign-in attempt. */
export type Authorization = {
  /** Fresh for each attempt; the callback must carry it back. */
  state: string;
  /** Where the loopback callback listens; port 0 takes any free port. */
  callback: { port: number; path: string };
  /** The page to open in the browser, once the callback's port is known. */
  url(port: number): string;
  /** Exchanges the callback's parameters for a credential. */
  complete(params: URLSearchParams, signal: AbortSignal): Promise<Credential>;
};
export type AuthorizeContext = {
  /** The saved credential of this sign-in method, to sign the same registration in again. */
  previous: Credential | null;
  /** This installation's stable ID, created when first needed. */
  hostId(): Promise<string>;
};
/** A way of signing in to OpenAI. */
export interface SignInMethod {
  authorize(context: AuthorizeContext): Promise<Authorization>;
  refresh(credential: Credential, signal: AbortSignal): Promise<Credential>;
}
