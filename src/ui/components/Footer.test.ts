import { expect, test } from "bun:test";
import { getLoadingIndicatorFrame } from "./Footer.tsx";

test("getLoadingIndicatorFrame cycles spinner and dots for the loading footer", () => {
  expect(getLoadingIndicatorFrame(0)).toEqual({
    badge: "[AI]",
    spinner: "-",
    dots: "",
  });

  expect(getLoadingIndicatorFrame(1)).toEqual({
    badge: "[AI]",
    spinner: "\\",
    dots: ".",
  });

  expect(getLoadingIndicatorFrame(4)).toEqual({
    badge: "[AI]",
    spinner: "-",
    dots: "",
  });
});
