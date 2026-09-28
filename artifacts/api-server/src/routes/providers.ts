import { Router, type IRouter } from "express";
import { GetProviderIntegrationStatusResponse } from "@workspace/api-zod";
import { providerRegistry } from "../connectors";

const router: IRouter = Router();

router.get("/providers/status", (_req, res) => {
  res.setHeader("Cache-Control", "no-store");

  const data = GetProviderIntegrationStatusResponse.parse({
    providers: providerRegistry.list().map((provider) => ({
      id: provider.id,
      name: provider.name,
      searchAvailability: provider.searchEnabled
        ? "enabled"
        : provider.requiresCredentials
          ? "authorized_access_required"
          : "disabled",
      affiliateCapability: provider.affiliateCapability,
      priceMonitoringCapability: provider.priceMonitoringCapability,
      credentialsRequired: provider.credentialRequirements,
      integrationStatus: provider.integrationStatus,
      country: provider.country,
      currency: provider.currency,
      integrationType: provider.integrationType,
      priority: provider.priority,
      lastSuccessfulSync: provider.lastSuccessfulSync,
      imageHealth: provider.imageHealth ?? {
        populatedImageCount: 0,
        sampledImageCount: 0,
        reachableImageCount: 0,
        status: "not_checked",
        lastCheckedAt: null,
      },
    })),
  });

  res.json(data);
});

export default router;