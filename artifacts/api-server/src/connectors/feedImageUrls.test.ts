import assert from "node:assert/strict";
import test from "node:test";
import { collectFeedImageUrls } from "./feedImageUrls";

test("keeps official image order, discovers numbered fields, and removes duplicates", () => {
  const images = collectFeedImageUrls(
    {
      image_link: " https://cdn.example/primary.jpg ",
      image_link_2: "https://cdn.example/alternate.jpg",
      picture_2: "https://cdn.example/alternate.jpg",
      image_url_3: "https://cdn.example/third.jpg",
      image_link_4: "file:///tmp/not-a-feed-image.jpg",
    },
    ["image_link", "picture"],
  );

  assert.deepEqual(images, [
    "https://cdn.example/primary.jpg",
    "https://cdn.example/alternate.jpg",
    "https://cdn.example/third.jpg",
  ]);
});

test("rejects non-HTTP URLs and keeps missing image lists empty", () => {
  assert.deepEqual(
    collectFeedImageUrls(
      {
        image: "data:image/png;base64,not-an-official-feed-url",
        picture: "javascript:alert(1)",
      },
      ["image", "picture"],
    ),
    [],
  );
});