const A4_RATIO = 297 / 210;

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

const waitForImage = async (image: HTMLImageElement) => {
  if (image.complete && image.naturalWidth) return;
  await new Promise<void>((resolve, reject) => {
    image.addEventListener("load", () => resolve(), { once: true });
    image.addEventListener("error", () => reject(new Error("打印图像加载失败")), { once: true });
  });
};

export const waitForPrintImages = async (container: ParentNode = document) => {
  const images = [...container.querySelectorAll<HTMLImageElement>(".standalone-quote-print-raster-page")];
  await Promise.all(images.map(waitForImage));
  await nextFrame();
};

export const getA4PageSlices = (height: number, width: number) => {
  const pageHeight = Math.max(1, Math.round(width * A4_RATIO));
  const slices: Array<{ height: number; top: number }> = [];
  for (let top = 0; top < height; top += pageHeight) {
    slices.push({ height: Math.min(pageHeight, height - top), top });
  }
  return { pageHeight, slices };
};

const cssPixels = (value: string) => Number.parseFloat(value) || 0;
const isTransparent = (value: string) => value === "transparent" || value === "rgba(0, 0, 0, 0)";

const drawBox = (
  context: CanvasRenderingContext2D,
  element: HTMLElement,
  rootBounds: DOMRect,
  scale: number,
) => {
  const styles = window.getComputedStyle(element);
  if (styles.display === "none" || styles.visibility === "hidden") return false;
  const bounds = element.getBoundingClientRect();
  const x = (bounds.left - rootBounds.left) * scale;
  const y = (bounds.top - rootBounds.top) * scale;
  const width = bounds.width * scale;
  const height = bounds.height * scale;

  context.save();
  context.globalAlpha = Number.parseFloat(styles.opacity) || 1;
  if (!isTransparent(styles.backgroundColor)) {
    context.fillStyle = styles.backgroundColor;
    context.fillRect(x, y, width, height);
  }

  const borders = [
    ["top", styles.borderTopWidth, styles.borderTopColor],
    ["right", styles.borderRightWidth, styles.borderRightColor],
    ["bottom", styles.borderBottomWidth, styles.borderBottomColor],
    ["left", styles.borderLeftWidth, styles.borderLeftColor],
  ] as const;
  borders.forEach(([side, borderWidth, color]) => {
    const size = cssPixels(borderWidth) * scale;
    if (!size || isTransparent(color)) return;
    context.fillStyle = color;
    if (side === "top") context.fillRect(x, y, width, size);
    if (side === "right") context.fillRect(x + width - size, y, size, height);
    if (side === "bottom") context.fillRect(x, y + height - size, width, size);
    if (side === "left") context.fillRect(x, y, size, height);
  });
  context.restore();
  return true;
};

const drawText = (
  context: CanvasRenderingContext2D,
  node: Text,
  parent: HTMLElement,
  rootBounds: DOMRect,
  scale: number,
) => {
  const value = node.data;
  if (!value.trim()) return;
  const styles = window.getComputedStyle(parent);
  const fontSize = cssPixels(styles.fontSize) * scale;
  context.save();
  context.globalAlpha = Number.parseFloat(styles.opacity) || 1;
  context.fillStyle = styles.color;
  context.font = `${styles.fontStyle} ${styles.fontWeight} ${fontSize}px ${styles.fontFamily}`;
  context.textBaseline = "alphabetic";

  let offset = 0;
  for (const character of Array.from(value)) {
    const nextOffset = offset + character.length;
    const range = document.createRange();
    range.setStart(node, offset);
    range.setEnd(node, nextOffset);
    const bounds = range.getBoundingClientRect();
    if (bounds.width || bounds.height) {
      const x = (bounds.left - rootBounds.left) * scale;
      const y = (bounds.top - rootBounds.top) * scale
        + (bounds.height * scale + fontSize) / 2
        - fontSize * 0.14;
      context.fillText(character, x, y);
    }
    offset = nextOffset;
  }
  context.restore();
};

const drawElement = async (
  context: CanvasRenderingContext2D,
  element: HTMLElement,
  rootBounds: DOMRect,
  scale: number,
) => {
  if (!drawBox(context, element, rootBounds, scale)) return;

  if (element instanceof HTMLImageElement) {
    await waitForImage(element);
    const bounds = element.getBoundingClientRect();
    context.drawImage(
      element,
      (bounds.left - rootBounds.left) * scale,
      (bounds.top - rootBounds.top) * scale,
      bounds.width * scale,
      bounds.height * scale,
    );
    return;
  }

  for (const child of element.childNodes) {
    if (child instanceof Text) drawText(context, child, element, rootBounds, scale);
    if (child instanceof HTMLElement) await drawElement(context, child, rootBounds, scale);
  }
};

const renderElementToCanvas = async (element: HTMLElement, scale: number) => {
  const bounds = element.getBoundingClientRect();
  const width = Math.ceil(Math.max(bounds.width, element.scrollWidth));
  const height = Math.ceil(Math.max(bounds.height, element.scrollHeight));
  if (!width || !height) throw new Error("报价单尚未完成排版");

  const canvas = document.createElement("canvas");
  canvas.width = width * scale;
  canvas.height = height * scale;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("当前浏览器无法生成打印图像");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  await drawElement(context, element, bounds, scale);
  return canvas;
};

export const renderQuoteToA4Images = async (element: HTMLElement, scale = 2) => {
  if (document.fonts?.ready) await document.fonts.ready;
  const canvas = await renderElementToCanvas(element, scale);
  const { pageHeight, slices } = getA4PageSlices(canvas.height, canvas.width);

  return slices.map((slice) => {
    const page = document.createElement("canvas");
    page.width = canvas.width;
    page.height = pageHeight;
    const pageContext = page.getContext("2d");
    if (!pageContext) throw new Error("当前浏览器无法生成打印分页");
    pageContext.fillStyle = "#ffffff";
    pageContext.fillRect(0, 0, page.width, page.height);
    pageContext.drawImage(
      canvas,
      0,
      slice.top,
      canvas.width,
      slice.height,
      0,
      0,
      canvas.width,
      slice.height,
    );
    return page.toDataURL("image/png");
  });
};
