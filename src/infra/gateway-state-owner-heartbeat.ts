import fs from "node:fs";
import { MessageChannel, receiveMessageOnPort } from "node:worker_threads";
import { coerceErrorMessage } from "@openclaw/normalization-core/error-coercion";
import { runInDetachedAsyncContext } from "../shared/detached-async-context.js";
import { GATEWAY_OWNER_HEARTBEAT_MS } from "./gateway-lock-payload.js";
import type { GatewayStateOwnerHeartbeatData } from "./gateway-state-owner-heartbeat.runtime.js";
import { runtimeProcessEntrypoints } from "./runtime-process-entrypoints.js";
import {
  resolveRuntimeWorkerThreadExecArgv,
  resolveRuntimeWorkerUrl,
} from "./runtime-worker-url.js";
import { createCpuTrackedWorker } from "./worker-cpu.js";

const now = Date.now.bind(Date);

// Bounded post-suspension renewal wait; generous for a waking disk, far below
// the failure deadline that foreign-namespace observers apply to mtime.
const RESUME_RENEWAL_WAIT_MS = 5_000;

/** Process and schema owners share one renewal worker and one failure deadline. */
export function startGatewayStateOwnerHeartbeat(
  heldLocks: Iterable<{ lockPath: string; verifyStillHeld(): boolean }>,
  onLost: (error: Error) => void,
) {
  const locks: Record<string, string> = {};
  for (const lock of heldLocks) {
    locks[lock.lockPath] = fs.readFileSync(lock.lockPath, "utf8");
    if (!lock.verifyStillHeld()) {
      throw new Error("OpenClaw state ownership is no longer current");
    }
  }
  return runInDetachedAsyncContext(() => {
    const lastBeat = new BigInt64Array(new SharedArrayBuffer(BigInt64Array.BYTES_PER_ELEMENT));
    // Match the lock's mtime clock; Bun workers have independent hrtime origins.
    Atomics.store(lastBeat, 0, BigInt(now()));
    const { port1, port2 } = new MessageChannel();
    const url = resolveRuntimeWorkerUrl(runtimeProcessEntrypoints.gatewayStateOwnerHeartbeat);
    const worker = createCpuTrackedWorker(url, {
      workerData: {
        locks,
        intervalMs: GATEWAY_OWNER_HEARTBEAT_MS,
        failureMs: 60_000,
        lastBeat: lastBeat.buffer,
        events: port2,
      } satisfies GatewayStateOwnerHeartbeatData,
      transferList: [port2],
      execArgv: resolveRuntimeWorkerThreadExecArgv(url),
    });
    worker.unref();
    port1.unref();
    let failure: string | null = null;
    let workerExited = false;
    worker.on("error", (error) => {
      failure = coerceErrorMessage(error);
    });
    worker.on("exit", () => {
      workerExited = true;
    });
    const inspect = () => {
      // Drain diagnostics synchronously when native work resumes before port callbacks.
      let message;
      while ((message = receiveMessageOnPort(port1))) {
        failure = message.message;
      }
      // Sample after loading the beat so concurrent renewal cannot appear to be in the future.
      let renewedAt = Atomics.load(lastBeat, 0);
      let age = now() - Number(renewedAt);
      if (age >= 60_000 && failure === null && !workerExited) {
        // An OS suspension freezes the renewal worker too, so an overdue beat with
        // a live silent worker is indistinguishable from sleep. Give the worker one
        // bounded round-trip to re-baseline from a fresh verified stamp; a wedged
        // or disk-stalled worker misses the window and still forfeits custody.
        worker.postMessage("beat", []);
        Atomics.wait(lastBeat, 0, renewedAt, RESUME_RENEWAL_WAIT_MS);
        renewedAt = Atomics.load(lastBeat, 0);
        age = now() - Number(renewedAt);
        while ((message = receiveMessageOnPort(port1))) {
          failure = message.message;
        }
      }
      const remaining = age < 0 ? 0 : 60_000 - age;
      if (remaining <= 0) {
        onLost(
          new Error(
            `Gateway state ownership is no longer current at ${Object.keys(locks)[0]}: ${failure ?? (age < 0 ? "heartbeat clock moved backwards" : "utimes heartbeat renewal did not complete within 60 seconds")}; restart the Gateway.`,
          ),
        );
      }
      return remaining;
    };
    let timer: ReturnType<typeof setTimeout>;
    const watch = () => {
      const remaining = inspect();
      if (remaining > 0) {
        timer = setTimeout(watch, remaining);
        timer.unref();
      }
    };
    watch();
    return {
      worker,
      paths: new Set(Object.keys(locks)),
      inspect,
      stop() {
        clearTimeout(timer);
        port1.close();
        worker.postMessage("stop", []);
        void worker.terminate();
      },
    };
  });
}
