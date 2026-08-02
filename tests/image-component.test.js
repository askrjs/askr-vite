import { describe, expect, it } from "vitest";
import { renderToStringSync } from "@askrjs/askr/ssr";
import { Image } from "../src/image.ts";

describe("responsive Image", () => {
  it("should render picture sources, intrinsic dimensions, and forwarded image attributes", () => {
    const html = renderToStringSync(() =>
      Image({
        image: {
          __askrImage: true,
          src: "/assets/hero.jpg",
          srcset: "/assets/hero-320.jpg 320w, /assets/hero.jpg 960w",
          width: 960,
          height: 540,
          sources: [
            {
              type: "image/avif",
              srcset: "/assets/hero-320.avif 320w, /assets/hero.avif 960w",
            },
          ],
        },
        alt: "Mountain ridge",
        sizes: "(min-width: 60rem) 50vw, 100vw",
        class: "hero",
        decoding: "async",
      }),
    );

    expect(html).toContain("<picture>");
    expect(html).toContain('type="image/avif"');
    expect(html).toContain('srcset="/assets/hero-320.avif 320w, /assets/hero.avif 960w"');
    expect(html).toContain('width="960"');
    expect(html).toContain('height="540"');
    expect(html).toContain('alt="Mountain ridge"');
    expect(html).toContain('class="hero"');
    expect(html).toContain('decoding="async"');
    expect(html).not.toContain("loading=");
  });
});
