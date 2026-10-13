import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ModelDefinitionConfig } from "../config/types.models.js";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import {
  isPluginMetadataSnapshotCompatible,
  loadPluginMetadataSnapshot,
} from "../plugins/plugin-metadata-snapshot.js";
import { createPluginMetadataSnapshotFixture } from "../plugins/plugin-metadata.test-support.js";
import { normalizeConfigMutationModelRefs } from "./config-cli-model-normalization.js";

vi.mock("../plugins/plugin-metadata-snapshot.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../plugins/plugin-metadata-snapshot.js")>()),
  isPluginMetadataSnapshotCompatible: vi.fn(),
  loadPluginMetadataSnapshot: vi.fn(),
}));

const metadata = createPluginMetadataSnapshotFixture({
  plugins: [
    {
      id: "custom-provider",
      modelIdNormalization: {
        providers: { custom: { aliases: { latest: "stable" }, prefixWhenBare: "vendor" } },
      },
    },
  ],
});
const modelFixture = (id: string): ModelDefinitionConfig => ({
  id,
  name: id,
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 8192,
  maxTokens: 4096,
});
const catalogConfig = (): OpenClawConfig => ({
  models: {
    providers: {
      custom: {
        baseUrl: "https://example.test/v1",
        models: [modelFixture(" latest "), modelFixture("other")],
      },
    },
  },
});

describe("config mutation model normalization", () => {
  beforeEach(() => {
    vi.mocked(loadPluginMetadataSnapshot).mockReset().mockReturnValue(metadata);
    vi.mocked(isPluginMetadataSnapshotCompatible).mockReset().mockReturnValue(true);
  });

  it("keeps core-only mutations independent from plugin discovery", () => {
    expect(normalizeConfigMutationModelRefs({ gateway: { mode: "local" } })).toEqual({
      gateway: { mode: "local" },
    });
    expect(
      normalizeConfigMutationModelRefs({
        models: { providers: { custom: { baseUrl: "https://example.test", models: [] } } },
      }),
    ).toBeDefined();
    expect(loadPluginMetadataSnapshot).toHaveBeenCalledTimes(0);
  });

  it.each(["defaults", "entries", "list"] as const)(
    "normalizes all %s agent model fields without discovering plugins",
    (scope) => {
      const ref = " together/meta-llama/Llama-3.3-70B-Instruct-Turbo ";
      const normalized = "together/meta-llama/Llama-3.3-70B-Instruct-Turbo";
      const selection = { primary: ref, fallbacks: [ref] };
      const expectedSelection = { primary: normalized, fallbacks: [normalized] };
      const fields = {
        model: selection,
        imageModel: selection,
        voiceModel: selection,
        pdfModel: selection,
        utilityModel: ref,
        mediaModels: { image: selection, video: selection, music: selection },
        heartbeat: { model: ref },
        subagents: { model: selection },
        compaction: { model: ref, memoryFlush: { model: ref } },
        models: { [ref]: { alias: "test" } },
      };
      const expected = {
        model: expectedSelection,
        imageModel: expectedSelection,
        voiceModel: expectedSelection,
        pdfModel: expectedSelection,
        utilityModel: normalized,
        mediaModels: {
          image: expectedSelection,
          video: expectedSelection,
          music: expectedSelection,
        },
        heartbeat: { model: normalized },
        subagents: { model: expectedSelection },
        compaction: { model: normalized, memoryFlush: { model: normalized } },
        models: { [normalized]: { alias: "test" } },
      };
      const wrap = (value: unknown) => ({
        agents: {
          [scope]: scope === "defaults" ? value : scope === "list" ? [value] : { a: value },
        },
      });
      expect(normalizeConfigMutationModelRefs(wrap(fields) as OpenClawConfig)).toEqual(
        wrap(expected),
      );
      expect(loadPluginMetadataSnapshot).toHaveBeenCalledTimes(0);
    },
  );

  it.each([false, true])("applies provider policies with prepared metadata=%s", (prepared) => {
    const result = normalizeConfigMutationModelRefs(
      catalogConfig(),
      prepared ? { pluginMetadataSnapshot: metadata } : undefined,
    );
    expect(result.models?.providers?.custom?.models.map((model) => model.id)).toEqual([
      "vendor/stable",
      "vendor/other",
    ]);
    expect(loadPluginMetadataSnapshot).toHaveBeenCalledTimes(prepared ? 0 : 1);
  });

  it("reloads policies when plugin discovery inputs change", () => {
    vi.mocked(isPluginMetadataSnapshotCompatible).mockReturnValue(false);
    const config = { ...catalogConfig(), plugins: { load: { paths: ["/new-plugin-root"] } } };
    const env = { OPENCLAW_STATE_DIR: "/isolated-state" };
    normalizeConfigMutationModelRefs(config, { pluginMetadataSnapshot: metadata, env });
    expect(loadPluginMetadataSnapshot).toHaveBeenCalledTimes(1);
    const [loaded] = vi.mocked(loadPluginMetadataSnapshot).mock.calls;
    expect(loaded?.[0].config).toBe(config);
    expect(loaded?.[0].env === env).toBe(true);
  });
});
