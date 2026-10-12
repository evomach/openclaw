import {
  PROVIDER_CONTEXT_HANDOFF,
  type ProviderContext,
  type ProviderStreamOptions,
} from "@openclaw/ai/provider-types";
import type { StreamFn } from "openclaw/plugin-sdk/agent-core";
import type { AgentMessage } from "../../runtime/index.js";

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
    return streamFn(model, nextContext, {
      ...options,
      [PROVIDER_CONTEXT_HANDOFF]: handoff,
    } as ProviderStreamOptions & NonNullable<Parameters<StreamFn>[2]>);
  };
}
