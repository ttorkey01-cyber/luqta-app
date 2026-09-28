import { createHash } from "node:crypto";
import type { RequestHandler } from "express";
import { eq } from "drizzle-orm";
import { db, huntDevices } from "@workspace/db";

declare global {
  namespace Express {
    interface Request {
      huntDevice?: typeof huntDevices.$inferSelect;
    }
  }
}

export const requireHuntDevice: RequestHandler = async (req, res, next) => {
  const accessToken = req.header("authorization")?.match(
    /^Bearer ([A-Za-z0-9_-]{43})$/u,
  )?.[1];

  if (!accessToken) {
    res.status(401).json({ error: "Device authorization is required" });
    return;
  }

  try {
    const accessTokenHash = createHash("sha256")
      .update(accessToken)
      .digest("hex");
    const [device] = await db
      .select()
      .from(huntDevices)
      .where(eq(huntDevices.accessTokenHash, accessTokenHash))
      .limit(1);

    if (!device) {
      res.status(401).json({ error: "Device authorization is invalid" });
      return;
    }

    req.huntDevice = device;
    next();
  } catch (error) {
    next(error);
  }
};