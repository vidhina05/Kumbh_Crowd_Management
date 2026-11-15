import { afterEach, describe, expect, it, vi } from "vitest";
import { resetEnvCacheForTests } from "@/server/env";

describe("Bhashini integration safety", () => {
  afterEach(() => { vi.unstubAllGlobals(); delete process.env.BHASHINI_USER_ID; delete process.env.BHASHINI_API_KEY; resetEnvCacheForTests(); });

  it("never calls a callback URL outside bhashini.gov.in (SSRF guard)", async () => {
    process.env.BHASHINI_USER_ID = "u"; process.env.BHASHINI_API_KEY = "k"; resetEnvCacheForTests();
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      calls.push(url);
      return new Response(JSON.stringify({
        pipelineResponseConfig: [{ config: [{ serviceId: "svc" }] }],
        pipelineInferenceAPIEndPoint: { callbackUrl: "http://169.254.169.254/latest/meta-data", inferenceApiKey: { name: "Authorization", value: "x" } },
      }), { status: 200 });
    }));
    const { textToSpeech } = await import("@/server/integrations/bhashini");
    await expect(textToSpeech("hello", "hi")).rejects.toMatchObject({ code: "voice_failed" });
    expect(calls.some((c) => c.includes("169.254"))).toBe(false);
  });

  it("parses a well-formed Bhashini TTS response", async () => {
    process.env.BHASHINI_USER_ID = "u"; process.env.BHASHINI_API_KEY = "k"; resetEnvCacheForTests();
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.includes("getModelsPipeline")) return new Response(JSON.stringify({
        pipelineResponseConfig: [{ config: [{ serviceId: "svc-ta" }] }],
        pipelineInferenceAPIEndPoint: { callbackUrl: "https://dhruva-api.bhashini.gov.in/services/inference/pipeline", inferenceApiKey: { name: "Authorization", value: "x" } },
      }));
      return new Response(JSON.stringify({ pipelineResponse: [{ audio: [{ audioContent: "UklGRg==" }] }] }));
    }));
    const { textToSpeech } = await import("@/server/integrations/bhashini");
    await expect(textToSpeech("வணக்கம்", "ta")).resolves.toBe("UklGRg==");
  });
});
