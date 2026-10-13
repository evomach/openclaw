import { resolveGlobalSingleton } from "../../shared/global-singleton.js";
import type { TurnAdoptionLifecycle } from "../get-reply-options.types.js";
import type { FinalizedMsgContext } from "../templating.js";

// Host-owned custody follows the exact prepared input across the SDK dispatch adapter.
type ReplyTurnAdoption = { adopt: () => Promise<void>; assertCurrent: () => void };

const adoptions = resolveGlobalSingleton(
  Symbol.for("openclaw.replyTurnAdoption"),
  () => new WeakMap<FinalizedMsgContext, ReplyTurnAdoption>(),
);

export function bindReplyTurnAdoption(
  ctx: FinalizedMsgContext,
  lifecycle: TurnAdoptionLifecycle,
): () => void {
  let pending: Promise<void> | undefined;
  let failure: { error: unknown } | undefined;
  const adoption: ReplyTurnAdoption = {
    assertCurrent: () => {
      if (adoptions.get(ctx) !== adoption) {
        throw new Error("Reply input adoption is no longer active.");
      }
      if (failure) {
        throw failure.error;
      }
    },
    adopt: () => {
      adoption.assertCurrent();
      return (pending ??= Promise.resolve()
        .then(() => lifecycle.onAdopted())
        .catch((error: unknown) => {
          failure = { error };
          throw error;
        }));
    },
  };
  adoptions.set(ctx, adoption);
  return () => {
    if (adoptions.get(ctx) === adoption) {
      adoptions.delete(ctx);
    }
  };
}

export function readReplyTurnAdoption(ctx: FinalizedMsgContext) {
  return adoptions.get(ctx);
}
