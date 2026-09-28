import { randomUUID } from "node:crypto";
import { Router, type IRouter } from "express";
import {
  SearchProductsBody,
  SearchProductsResponse,
} from "@workspace/api-zod";
import { searchOrchestrator } from "../connectors";
import { logger } from "../lib/logger";

const router: IRouter = Router();

router.post("/search", async (req, res, next) => {
  const requestStartedAt = performance.now();
  const traceId = randomUUID();
  let category: string | undefined;
  let searchMode: string | undefined;
  const emitStage = (
    stage: string,
    details: Record<string, unknown> = {},
  ) => {
    logger.info(
      {
        traceId,
        stage,
        requestElapsedMs: Number(
          (performance.now() - requestStartedAt).toFixed(2),
        ),
        category,
        searchMode,
        ...details,
      },
      "Search pipeline stage",
    );
  };
  emitStage("request_received");
  try {
    const request = SearchProductsBody.parse(req.body);
    category = request.category;
    searchMode = request.searchMode;
    emitStage("request_validated", {
      page: request.page,
      pageSize: request.pageSize,
    });
    const result = await searchOrchestrator.searchWithMetadata(
      request,
      emitStage,
    );
    const serializationStartedAt = performance.now();
    emitStage("serialization_start", {
      productCount: result.products.length,
    });
    const parsed = SearchProductsResponse.parse(result);
    const handlerMs = performance.now() - requestStartedAt;
    emitStage("serialization_end", {
      durationMs: Number(
        (performance.now() - serializationStartedAt).toFixed(2),
      ),
      productCount: parsed.products.length,
    });
    res.once("finish", () => {
      logger.info(
        {
          traceId,
          stage: "response_sent",
          statusCode: res.statusCode,
          totalMs: Number((performance.now() - requestStartedAt).toFixed(2)),
          category: request.category,
          searchMode: request.searchMode,
          page: request.page,
          productCount: parsed.products.length,
          handlerMs: Number(handlerMs.toFixed(2)),
          serializationMs: Number(
            (performance.now() - serializationStartedAt).toFixed(2),
          ),
          searchTimings: result.__timings,
        },
        "Search request timing",
      );
    });
    res.json(parsed);
  } catch (error) {
    emitStage("request_error", {
      errorType: error instanceof Error ? error.name : "UnknownError",
    });
    next(error);
  }
});

export default router;