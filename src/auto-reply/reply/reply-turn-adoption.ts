import { resolveGlobalSingleton } from "../../shared/global-singleton.js";
import type { TurnAdoptionLifecycle } from "../get-reply-options.types.js";
import type { FinalizedMsgContext } from "../templating.js";

// Host-owned custody follows the exact prepared input across the SDK dispatch adapter.
const adoptions = resolveGlobalSingleton(
  Symbol.for("openclaw.replyTurnAdoption"),
  () => new WeakMap<FinalizedMsgContext, () => Promise<void>>(),
);

export function bindReplyTurnAdoption(
  ctx: FinalizedMsgContext,
  lifecycle: TurnAdoptionLifecycle,
): () => void {
  let pending: Promise<void> | undefined;
  const adopt = () => {
    if (adoptions.get(ctx) !== adopt) {
      return Promise.reject(new Error("Reply input adoption is no longer active."));
    }
    return (pending ??= Promise.resolve().then(() => lifecycle.onAdopted()));
  };
  adoptions.set(ctx, adopt);
  return () => {
    if (adoptions.get(ctx) === adopt) {
      adoptions.delete(ctx);
    }
  };
}

export function readReplyTurnAdoption(ctx: FinalizedMsgContext) {
  return adoptions.get(ctx);
}
