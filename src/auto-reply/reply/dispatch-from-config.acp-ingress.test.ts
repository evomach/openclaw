import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { createDeferred } from "../../../test/helpers/promise.js";
import { consumeAcpTurnStream } from "../../acp/control-plane/manager.turn-stream.js";
import type { AcpRunTurnInput } from "../../acp/control-plane/manager.types.js";
import { bindIngressLifecycleToReplyOptions } from "../../channels/message/ingress-drain-lifecycle.js";
import { createChannelIngressDrain } from "../../channels/message/ingress-drain.js";
import {
  createTestIngressQueue,
  withTempState,
} from "../../channels/message/ingress-drain.test-helpers.js";
import {
  acpManagerRuntimeMocks,
  acpMocks,
  createDispatcher,
} from "./dispatch-from-config.shared.test-harness.js";
import {
  automaticDirectReplyConfig,
  createAcpRuntime,
  describe0BeforeEach0,
  dispatchReplyFromConfig,
  globalBeforeAll0,
  setNoAbort,
} from "./dispatch-from-config.test-support.js";
import { testing as replyRunTesting } from "./reply-run-registry.test-support.js";
import { buildTestCtx } from "./test-ctx.js";
import { createAcpSessionMeta } from "./test-fixtures/acp-runtime.js";

beforeAll(globalBeforeAll0);
beforeEach(() => {
  describe0BeforeEach0();
  setNoAbort();
  vi.useFakeTimers();
});
afterEach(() => {
  replyRunTesting.resetReplyRunRegistry();
  vi.clearAllTimers();
  vi.useRealTimers();
});

it.each(["completed", "cancelled", "adoption-rejected"] as const)(
  "retains ACP ingress ownership through %s without replaying its input",
  async (outcome) => {
    await withTempState(async (stateDir) => {
      const sessionKey = "agent:main:acp:ingress";
      const cfg = {
        ...automaticDirectReplyConfig,
        acp: { enabled: true, dispatch: { enabled: true } },
      };
      const ctx = buildTestCtx({
        Provider: "discord",
        Surface: "discord",
        ChatType: "direct",
        SessionKey: sessionKey,
        MessageSid: "long-acp-turn",
        BodyForAgent: "Complete the long task",
      });
      acpMocks.readAcpSessionEntry.mockReturnValue({ acp: createAcpSessionMeta() });
      const started = createDeferred();
      const release = createDeferred();
      const runtime = createAcpRuntime([]);
      runtime.runTurn.mockImplementation(async function* () {
        started.resolve();
        await release.promise;
        if (outcome === "completed") {
          yield { type: "text_delta", text: "Long task completed." };
        }
        yield { type: "done", status: outcome === "cancelled" ? "cancelled" : "completed" };
      });
      const manager = acpManagerRuntimeMocks.getAcpSessionManager();
      const runTurn = vi.fn(async (input: AcpRunTurnInput) => {
        await consumeAcpTurnStream({
          runtime,
          turn: {
            ...input,
            handle: {
              sessionKey,
              backend: "acpx",
              runtimeSessionName: "runtime:ingress",
            },
          },
          eventGate: { open: true },
          onBeforePrompt: input.onBeforePrompt,
          onEvent: input.onEvent,
        });
      });
      acpManagerRuntimeMocks.getAcpSessionManager.mockReturnValue({ ...manager, runTurn });
      const queue = createTestIngressQueue(stateDir);
      await queue.enqueue("long-acp-turn", { text: "Complete the long task" });
      const dispatcher = createDispatcher();
      const controller = new AbortController();
      const dispatched = createDeferred();
      const rejected = new Error("Ingress adoption refused");
      const drain = createChannelIngressDrain({
        queue,
        dispatchClaimedEvent: async (_event, lifecycle) => {
          const replyOptions = bindIngressLifecycleToReplyOptions(lifecycle);
          if (outcome === "adoption-rejected") {
            replyOptions.turnAdoptionLifecycle.onAdopted = async () => {
              throw rejected;
            };
          }
          try {
            await dispatchReplyFromConfig({
              ctx,
              cfg,
              dispatcher,
              replyOptions: { ...replyOptions, abortSignal: controller.signal },
            });
          } finally {
            dispatched.resolve();
          }
        },
      });
      try {
        await drain.drainOnce();
        if (outcome === "adoption-rejected") {
          await dispatched.promise;
          expect(runtime.runTurn).not.toHaveBeenCalled();
          expect(dispatcher.sendFinalReply).toHaveBeenCalledWith(
            expect.objectContaining({
              isError: true,
              text: expect.stringContaining(rejected.message),
            }),
          );
        } else {
          await Promise.race([
            started.promise,
            dispatched.promise.then(() => {
              throw new Error("ACP dispatch ended before backend submission");
            }),
          ]);
          expect(await queue.listClaims()).toEqual([]);
          await vi.advanceTimersByTimeAsync(300_001);
          expect(runTurn.mock.calls[0]?.[0].signal?.aborted).not.toBe(true);
          expect(await drain.drainOnce()).toEqual({ started: 0 });
          if (outcome === "cancelled") {
            controller.abort();
          }
          release.resolve();
          await dispatched.promise;
          if (outcome === "completed") {
            expect(dispatcher.sendFinalReply).toHaveBeenCalledExactlyOnceWith(
              expect.objectContaining({ text: "Long task completed." }),
            );
          } else {
            expect(dispatcher.sendFinalReply).not.toHaveBeenCalled();
          }
        }
        await drain.waitForIdle();
        expect(runTurn).toHaveBeenCalledOnce();
        expect(await queue.listPending()).toEqual([]);
        expect((await queue.enqueue("long-acp-turn", { text: "duplicate" })).kind).toBe(
          "completed",
        );
      } finally {
        release.resolve();
        drain.dispose();
        await drain.waitForIdle();
      }
    });
  },
);
