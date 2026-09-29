import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { providerRegistry } from "../connectors";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

router.get("/readyz", (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const providers = providerRegistry.list()
    .filter((provider) => provider.enabled && provider.integrationType === "affiliate_feed")
    .map((provider) => {
      const readiness = providerRegistry.get(provider.id)?.getSearchIndexReadiness?.();
      return {
        id: provider.id,
        ready: readiness?.ready ?? false,
        productCount: readiness?.productCount ?? 0,
        refreshing: readiness?.refreshing ?? false,
        lastSuccessfulSync: readiness?.lastSuccessfulSync ?? null,
      };
    });
  const ready = providers.length > 0 && providers.every((provider) => provider.ready);
  res.status(ready ? 200 : 503).json({
    status: ready ? "ready" : "warming",
    providers,
  });
});

export default router;
