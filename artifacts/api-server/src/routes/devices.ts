import { createHash, randomBytes } from "node:crypto";
import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import {
  DisableHuntPushTokenResponse,
  GetHuntDeviceResponse,
  RegisterHuntDeviceBody,
  RegisterHuntDeviceResponse,
  RegisterHuntPushTokenBody,
  RegisterHuntPushTokenResponse,
} from "@workspace/api-zod";
import { db, huntDevices } from "@workspace/db";
import { requireHuntDevice } from "./huntDeviceAuth";

const router: IRouter = Router();
const EXPO_PUSH_TOKEN_PATTERN =
  /^(?:ExpoPushToken|ExponentPushToken)\[[^\]\s]{8,180}\]$/u;

function serializeDevice(
  device: typeof huntDevices.$inferSelect,
): {
  deviceId: string;
  platform: "android" | "ios" | "web";
  pushNotificationsEnabled: boolean;
} {
  return {
    deviceId: device.id,
    platform: device.platform as "android" | "ios" | "web",
    pushNotificationsEnabled: device.pushNotificationsEnabled,
  };
}

router.post("/devices/register", async (req, res, next) => {
  try {
    const body = RegisterHuntDeviceBody.parse(req.body);
    const accessToken = randomBytes(32).toString("base64url");
    const accessTokenHash = createHash("sha256")
      .update(accessToken)
      .digest("hex");
    const [device] = await db
      .insert(huntDevices)
      .values({
        accessTokenHash,
        platform: body.platform,
      })
      .returning({
        id: huntDevices.id,
        createdAt: huntDevices.createdAt,
      });

    res.status(201).json(
      RegisterHuntDeviceResponse.parse({
        deviceId: device.id,
        accessToken,
        createdAt: device.createdAt.toISOString(),
      }),
    );
  } catch (error) {
    next(error);
  }
});

router.get("/devices/me", requireHuntDevice, async (req, res, next) => {
  try {
    const device = req.huntDevice!;
    await db
      .update(huntDevices)
      .set({ lastSeenAt: new Date() })
      .where(eq(huntDevices.id, device.id));
    res.json(GetHuntDeviceResponse.parse(serializeDevice(device)));
  } catch (error) {
    next(error);
  }
});

router.put("/devices/push-token", requireHuntDevice, async (req, res, next) => {
  try {
    const body = RegisterHuntPushTokenBody.parse(req.body);
    if (!EXPO_PUSH_TOKEN_PATTERN.test(body.expoPushToken)) {
      res.status(400).json({ error: "The Expo push token is invalid" });
      return;
    }

    const device = req.huntDevice!;
    const [existingOwner] = await db
      .select({ id: huntDevices.id })
      .from(huntDevices)
      .where(eq(huntDevices.expoPushToken, body.expoPushToken))
      .limit(1);
    if (existingOwner && existingOwner.id !== device.id) {
      res.status(409).json({ error: "The Expo push token is already registered" });
      return;
    }

    const [updated] = await db
      .update(huntDevices)
      .set({
        expoPushToken: body.expoPushToken,
        platform: body.platform,
        pushNotificationsEnabled: true,
        lastSeenAt: new Date(),
      })
      .where(eq(huntDevices.id, device.id))
      .returning();
    res.json(
      RegisterHuntPushTokenResponse.parse(serializeDevice(updated)),
    );
  } catch (error) {
    next(error);
  }
});

router.delete(
  "/devices/push-token",
  requireHuntDevice,
  async (req, res, next) => {
    try {
      const [updated] = await db
        .update(huntDevices)
        .set({
          expoPushToken: null,
          pushNotificationsEnabled: false,
          lastSeenAt: new Date(),
        })
        .where(eq(huntDevices.id, req.huntDevice!.id))
        .returning();
      res.json(
        DisableHuntPushTokenResponse.parse(serializeDevice(updated)),
      );
    } catch (error) {
      next(error);
    }
  },
);

export default router;