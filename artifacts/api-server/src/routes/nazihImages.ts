import { Router, type IRouter } from "express";
import { logger } from "../lib/logger";

const router: IRouter = Router();
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const ALLOWED_CONTENT_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);
const NAZIH_IMAGE_HEADERS = {
  Accept: "image/jpeg,image/*;q=0.8,*/*;q=0.5",
  Referer: "https://nazih.sa/",
  "User-Agent":
    "Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/140.0 Mobile Safari/537.36",
};

function isAllowedNazihImageUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.hostname === "nazih.sa" &&
      !url.port &&
      !url.username &&
      !url.password &&
      url.pathname.startsWith("/media/catalog/product/") &&
      /\.(?:jpe?g|png|webp)$/i.test(url.pathname)
    );
  } catch {
    return false;
  }
}

router.get("/images/nazih", async (req, res) => {
  const imageUrl = req.query.url;
  if (
    typeof imageUrl !== "string" ||
    imageUrl.length > 2048 ||
    !isAllowedNazihImageUrl(imageUrl)
  ) {
    res.status(400).json({ error: "Invalid Nazih image URL" });
    return;
  }

  try {
    const upstream = await fetch(imageUrl, {
      headers: NAZIH_IMAGE_HEADERS,
      redirect: "manual",
      signal: AbortSignal.timeout(15_000),
    });
    if (!upstream.ok) {
      logger.warn(
        { status: upstream.status },
        "Nazih image proxy upstream request failed",
      );
      res.status(502).end();
      return;
    }

    const contentType = upstream.headers
      .get("content-type")
      ?.split(";")[0]
      .trim()
      .toLowerCase();
    if (!contentType || !ALLOWED_CONTENT_TYPES.has(contentType)) {
      logger.warn(
        { contentType },
        "Nazih image proxy rejected upstream content type",
      );
      res.status(502).end();
      return;
    }

    const contentLength = Number(upstream.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > MAX_IMAGE_BYTES) {
      res.status(413).end();
      return;
    }

    const image = Buffer.from(await upstream.arrayBuffer());
    if (image.length === 0 || image.length > MAX_IMAGE_BYTES) {
      res.status(image.length > MAX_IMAGE_BYTES ? 413 : 502).end();
      return;
    }

    res
      .status(200)
      .set({
        "Content-Type": contentType,
        "Content-Length": String(image.length),
        "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
        "X-Content-Type-Options": "nosniff",
      })
      .send(image);
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "TimeoutError";
    logger.warn(
      { timedOut },
      "Nazih image proxy could not fetch upstream image",
    );
    res.status(timedOut ? 504 : 502).end();
  }
});

export default router;