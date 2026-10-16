import fs from "node:fs";
import { MessageChannel, receiveMessageOnPort, type Worker } from "node:worker_threads";
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
    const url = resolveRuntimeWorkerUrl(runtimeProcessEntrypoints.gatewayStateOwnerHeartbeat);
    let worker!: Worker;
    let port1!: MessageChannel["port1"];
    // A custody event is the worker's own proof verdict (lock replaced, renewal
    // failed): custody is gone and only a fence is honest. A worker crash or clean
    // exit without such an event says nothing about custody, so the synchronous
    // inode/content proof below decides whether the renewal loop may resume.
    let custodyEvent: string | null = null;
    let workerFault: string | null = null;
    let workerExited = false;
    // Late events from a replaced worker must not corrupt the respawned state.
    let spawnGeneration = 0;
    const spawn = () => {
      const generation = ++spawnGeneration;
      const channel = new MessageChannel();
      port1 = channel.port1;
      worker = createCpuTrackedWorker(url, {
        workerData: {
          // Fresh copy: projection locks added since the last spawn must be
          // renewed by a respawned worker too, not just the acquisition set.
          locks: { ...locks },
          intervalMs: GATEWAY_OWNER_HEARTBEAT_MS,
          failureMs: 60_000,
          lastBeat: lastBeat.buffer,
          events: channel.port2,
        } satisfies GatewayStateOwnerHeartbeatData,
        transferList: [channel.port2],
        execArgv: resolveRuntimeWorkerThreadExecArgv(url),
      });
      worker.unref();
      port1.unref();
      workerExited = false;
      workerFault = null;
      worker.on("error", (error) => {
        if (generation === spawnGeneration) {
          workerFault = coerceErrorMessage(error);
        }
      });
      worker.on("exit", () => {
        if (generation === spawnGeneration) {
          workerExited = true;
        }
      });
    };
    spawn();
    const drainEvents = () => {
      // Drain diagnostics synchronously when native work resumes before port callbacks.
      let message;
      while ((message = receiveMessageOnPort(port1))) {
        if (message.message !== null) {
          custodyEvent = message.message;
        }
      }
    };
    const inspect = () => {
      drainEvents();
      // Sample after loading the beat so concurrent renewal cannot appear to be in the future.
      let renewedAt = Atomics.load(lastBeat, 0);
      let age = now() - Number(renewedAt);
      // A negative age is a wall-clock step backwards (for example an NTP
      // correction after resume). Treat it as overdue so the recovery paths can
      // re-baseline from a verified touch instead of fencing on the step alone.
      const overdue = age >= 60_000 || age < 0;
      if (overdue && custodyEvent === null && !workerExited) {
        // An OS suspension freezes the renewal worker too, so an overdue beat with
        // a live silent worker is indistinguishable from sleep. Give the worker one
        // bounded round-trip to re-baseline from a fresh verified stamp; a wedged
        // or disk-stalled worker misses the window and falls through.
        worker.postMessage("beat", []);
        Atomics.wait(lastBeat, 0, renewedAt, RESUME_RENEWAL_WAIT_MS);
        renewedAt = Atomics.load(lastBeat, 0);
        age = now() - Number(renewedAt);
        drainEvents();
      }
      if ((age >= 60_000 || age < 0) && custodyEvent === null) {
        // The bounded worker round-trip can lose to a waking volume's first I/O after
        // OS suspension. Renew once synchronously with the same inode/content custody
        // proof the worker's beat performs: a completed verified touch honestly
        // re-stamps mtime, while a replaced or unreadable lock fences with its reason.
        // Admission already verifies these locks synchronously, so this adds no new
        // main-thread fs exposure. A dead worker is not a custody verdict: when the
        // proof passes below, custody continues and the renewal loop respawns.
        let oldestRenewal = 0n;
        let renewedAny = false;
        for (const [lockPath, raw] of Object.entries(locks)) {
          try {
            const fd = fs.openSync(lockPath, "r+");
            try {
              const held = fs.fstatSync(fd, { bigint: true });
              const current = fs.statSync(lockPath, { bigint: true });
              const bytes = Buffer.alloc(Buffer.byteLength(raw) + 1);
              const length = fs.readSync(fd, bytes, 0, bytes.length, 0);
              if (
                held.nlink === 0n ||
                held.dev !== current.dev ||
                held.ino !== current.ino ||
                bytes.subarray(0, length).toString("utf8") !== raw
              ) {
                custodyEvent = `${lockPath}: owner lock was removed or replaced`;
                break;
              }
              const renewalStartedAt = BigInt(now());
              const stamp = new Date(Number(renewalStartedAt));
              fs.futimesSync(fd, stamp, stamp);
              if (!renewedAny || renewalStartedAt < oldestRenewal) {
                oldestRenewal = renewalStartedAt;
              }
              renewedAny = true;
            } finally {
              fs.closeSync(fd);
            }
          } catch (error) {
            custodyEvent = `${lockPath}: utimes renewal failed: ${coerceErrorMessage(error)}`;
            break;
          }
        }
        if (!custodyEvent && renewedAny) {
          Atomics.store(lastBeat, 0, oldestRenewal);
          Atomics.notify(lastBeat, 0);
          renewedAt = oldestRenewal;
          age = now() - Number(renewedAt);
          if (workerExited || workerFault !== null) {
            // Custody survived; only the renewal loop died. Respawn it instead of
            // leaving the Gateway a listener whose every state call self-fences —
            // the zombie state that forced manual restarts after sleep/wake.
            spawn();
          }
        }
      }
      const remaining = age < 0 ? 0 : 60_000 - age;
      if (remaining <= 0) {
        // Keep the most specific reason: the worker's custody verdict, then its
        // crash message, then the observed timing symptom. A silent clean exit
        // must not masquerade as a renewal timeout.
        const reason =
          custodyEvent ??
          workerFault ??
          (age < 0
            ? "heartbeat clock moved backwards"
            : workerExited
              ? "heartbeat worker exited without a custody verdict"
              : "utimes heartbeat renewal did not complete within 60 seconds");
        onLost(
          new Error(
            `Gateway state ownership is no longer current at ${Object.keys(locks)[0]}: ${reason}; restart the Gateway.`,
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
      // Getter: respawn replaces the worker, and callers must reach the live one.
      get worker() {
        return worker;
      },
      paths: new Set(Object.keys(locks)),
      inspect,
      addLock(lockPath: string, raw: string) {
        // Record on this side too so a later respawn renews and proves it.
        locks[lockPath] = raw;
        this.paths.add(lockPath);
        worker.postMessage([lockPath, raw], []);
      },
      stop() {
        clearTimeout(timer);
        port1.close();
        worker.postMessage("stop", []);
        void worker.terminate();
      },
    };
  });
}
