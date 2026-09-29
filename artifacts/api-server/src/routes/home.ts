import { Router, type IRouter } from "express";
import { GetHomePicksResponse } from "@workspace/api-zod";
import { homeCurationService } from "../connectors";
import { InventoryUnavailableError } from "../connectors/searchOrchestrator";

const router: IRouter = Router();

router.get("/home/picks", async (_req, res, next) => {
  try {
    const picks = await homeCurationService.getPicks();
    res.json(GetHomePicksResponse.parse(picks));
  } catch (error) {
    if (error instanceof InventoryUnavailableError) {
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Retry-After", "5");
      res.status(503).json({
        code: "INVENTORY_UNAVAILABLE",
        error: "Product inventory is still warming. Please retry shortly.",
      });
      return;
    }
    next(error);
  }
});

export default router;