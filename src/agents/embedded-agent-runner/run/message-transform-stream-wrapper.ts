import {
  PROVIDER_CONTEXT_HANDOFF,
  type ProviderContext,
  type ProviderStreamOptions,
} from "@openclaw/ai/provider-types";
import type { StreamFn } from "openclaw/plugin-sdk/agent-core";
import type { AgentMessage } from "../../runtime/index.js";
import { log } from "../logger.js";

/** Set OPENCLAW_DEBUG_VIDEO_HANDOFF=1 to trace native-video materialization per turn. */
export function videoHandoffDebugEnabled(): boolean {
  return process.env.OPENCLAW_DEBUG_VIDEO_HANDOFF === "1";
}
function contextHasVideoMedia(context: Parameters<StreamFn>[1]): boolean {
  for (const message of context?.messages ?? []) {
    const meta = Reflect.get(message, "__openclaw") as
      | { media?: Array<{ kind?: string }> }
      | undefined;
    if (meta?.media?.some((entry) => entry?.kind === "video")) {
      return true;
    }
    const content = (message as { content?: unknown }).content;
    if (
      Array.isArray(content) &&
      content.some(
        (block) =>
          typeof block === "object" &&
          block !== null &&
          (block as { type?: string }).type === "text" &&
          typeof (block as { text?: string }).text === "string" &&
          (block as { text: string }).text.includes("video omitted"),
      )
    ) {
      return true;
    }
  }
  return false;
}

type MessageTransform = (
  messages: AgentMessage[],
  model: Parameters<StreamFn>[0],
) => AgentMessage[];
type ProviderContextMaterializer = (input: {
  context: Parameters<StreamFn>[1];
  signal?: AbortSignal;
}) => Promise<ProviderContext>;

export function wrapStreamFnWithMessageTransform(
  streamFn: StreamFn,
  transform: MessageTransform,
  materializeProviderContext?: ProviderContextMaterializer,
): StreamFn {
  return (model, context, options) => {
    const messages = context?.messages;
    const nextMessages = Array.isArray(messages)
      ? transform(messages as AgentMessage[], model)
      : messages;
    const nextContext =
      Array.isArray(messages) && nextMessages !== messages
        ? {
            ...context,
            messages: nextMessages as typeof context.messages,
          }
        : context;
    if (!materializeProviderContext) {
      return streamFn(model, nextContext, options);
    }
    let availableContext: Parameters<StreamFn>[1] | undefined = nextContext;
    let handoffPromise: Promise<ProviderContext> | undefined;
    const handoff = async (): Promise<ProviderContext> => {
      if (videoHandoffDebugEnabled()) {
        log.warn(`provider-context handoff consumed: model=${model?.id ?? "unknown"}`);
      }
      if (!handoffPromise) {
        const captured = availableContext;
        availableContext = undefined;
        if (!captured) {
          throw new Error("provider context handoff already consumed");
        }
        options?.signal?.throwIfAborted();
        handoffPromise = materializeProviderContext({
          context: captured,
          signal: options?.signal,
        });
      }
      return await handoffPromise;
    };
    if (videoHandoffDebugEnabled() && contextHasVideoMedia(nextContext)) {
      log.warn(`provider-context handoff installed: model=${model?.id ?? "unknown"}`);
    }
    return streamFn(model, nextContext, {
      ...options,
      [PROVIDER_CONTEXT_HANDOFF]: handoff,
    } as ProviderStreamOptions & NonNullable<Parameters<StreamFn>[2]>);
  };
}
