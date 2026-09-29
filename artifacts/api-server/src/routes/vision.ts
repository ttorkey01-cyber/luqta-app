import { Router, type IRouter } from "express";
import {
  InterpretProductImageBody,
  InterpretProductImageResponse,
} from "@workspace/api-zod";
import {
  isBoundedJpegDataUrl,
  normalizeImageUnderstanding,
  visionLimiter,
  visionLimitResponse,
} from "./visionHelpers";

const router: IRouter = Router();
const IMAGE_RECOGNITION_TIMEOUT_MS = 20_000;

const recognitionInstructions = [
  "Identify only the physical product genuinely visible in the supplied photo.",
  "Do not infer a product from the accompanying user text; that text is handled separately by search.",
  "If the object is unclear, small, occluded, or ambiguous, return primaryCandidate null or a low confidence score and provide at most three plausible alternatives.",
  "Never guess a brand or model. Set brand to null unless its mark is clearly legible in the image.",
  "Use concise Arabic labels and product-only search queries. Queries must never contain a brand or model; keep the product type generic and provide any clearly visible brand separately. Include only visually supported colors and attributes.",
  "Do not identify scenery, a room, a person, or a generic furniture item unless that object is actually the product in focus.",
  "Return one JSON object with primaryCandidate (name, query, confidence, productType, brand, color, attributes), alternatives (same candidate shape), and confidence.",
  "Use null for unsupported optional candidate facts and an empty array when there are no alternatives.",
].join(" ");

router.post("/vision/interpret", async (req, res): Promise<void> => {
  const parsed = InterpretProductImageBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "أرسل صورة JPEG صالحة ونصاً لا يتجاوز 200 حرف." });
    return;
  }

  const { imageDataUrl } = parsed.data;
  if (!isBoundedJpegDataUrl(imageDataUrl)) {
    res.status(413).json({ error: "حجم الصورة غير مدعوم. اختر صورة JPEG أصغر." });
    return;
  }

  const baseUrl = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL?.trim();
  const apiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY?.trim();
  if (!baseUrl || !apiKey) {
    res.status(503).json({ error: "البحث بالصورة غير متاح حالياً. جرّب البحث النصي." });
    return;
  }

  const admission = visionLimiter.acquire(
    req.ip || req.socket.remoteAddress || "unknown",
  );
  if (!admission.admitted) {
    const rejection = visionLimitResponse(admission.reason);
    res.setHeader("Retry-After", rejection.retryAfter);
    res.status(rejection.status).json({ error: rejection.error });
    return;
  }

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    IMAGE_RECOGNITION_TIMEOUT_MS,
  );
  try {
    const response = await fetch(
      `${baseUrl.replace(/\/+$/, "")}/chat/completions`,
      {
        method: "POST",
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-5-mini",
          reasoning_effort: "low",
          max_completion_tokens: 1800,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: recognitionInstructions },
            {
              role: "user",
              content: [
                { type: "text", text: "حلّل المنتج الظاهر في هذه الصورة." },
                {
                  type: "image_url",
                  image_url: { url: imageDataUrl, detail: "low" },
                },
              ],
            },
          ],
        }),
      },
    );

    if (!response.ok) {
      res.status(502).json({ error: "تعذّر التعرّف على الصورة. حاول مرة أخرى." });
      return;
    }

    const payload: unknown = await response.json();
    const completion =
      payload && typeof payload === "object"
        ? (payload as {
            choices?: Array<{ message?: { content?: unknown } }>;
          })
        : {};
    const content = completion.choices?.[0]?.message?.content;
    if (typeof content !== "string") {
      res.status(502).json({ error: "وصلت نتيجة تعرّف غير صالحة. حاول مرة أخرى." });
      return;
    }

    let modelResult: unknown;
    try {
      modelResult = JSON.parse(content);
    } catch {
      res.status(502).json({ error: "تعذّر قراءة نتيجة التعرّف. حاول مرة أخرى." });
      return;
    }

    res.json(InterpretProductImageResponse.parse(normalizeImageUnderstanding(modelResult)));
  } catch (error) {
    if (controller.signal.aborted) {
      res.status(504).json({ error: "استغرق تحليل الصورة وقتاً طويلاً. حاول مرة أخرى." });
      return;
    }
    req.log.warn(
      { errorType: error instanceof Error ? error.name : "UnknownError" },
      "Visual product recognition failed",
    );
    res.status(502).json({ error: "تعذّر التعرّف على الصورة. حاول مرة أخرى." });
  } finally {
    clearTimeout(timeout);
    admission.release();
  }
});

export default router;