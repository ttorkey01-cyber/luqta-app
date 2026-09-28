import { Router, type IRouter } from "express";
import { GetHomePicksResponse } from "@workspace/api-zod";
import { homeCurationService } from "../connectors";

const router: IRouter = Router();

router.get("/home/picks", async (_req, res, next) => {
  try {
    const picks = await homeCurationService.getPicks();
    res.json(GetHomePicksResponse.parse(picks));
  } catch (error) {
    next(error);
  }
});

export default router;