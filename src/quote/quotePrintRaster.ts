const XHTML_NAMESPACE = "http://www.w3.org/1999/xhtml";
const A4_RATIO = 297 / 210;

const toDataUrl = (blob: Blob) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onerror = () => reject(reader.error ?? new Error("图片读取失败"));
  reader.onload = () => resolve(String(reader.result));
  reader.readAsDataURL(blob);
});

const inlineImages = async (source: HTMLElement, clone: HTMLElement) => {
  const sourceImages = [
    ...(source instanceof HTMLImageElement ? [source] : []),
    ...source.querySelectorAll("img"),
  ];
  const cloneImages = [
    ...(clone instanceof HTMLImageElement ? [clone] : []),
    ...clone.querySelectorAll("img"),
  ];

  await Promise.all(sourceImages.map(async (image, index) => {
    const target = cloneImages[index];
    if (!target || !image.currentSrc) return;
    const response = await fetch(image.currentSrc);
    if (!response.ok) throw new Error("报价单标识读取失败");
    target.src = await toDataUrl(await response.blob());
  }));
};

const copyComputedStyles = (source: HTMLElement, clone: HTMLElement) => {
  const sourceElements = [source, ...source.querySelectorAll<HTMLElement>("*")];
  const cloneElements = [clone, ...clone.querySelectorAll<HTMLElement>("*")];

  sourceElements.forEach((element, index) => {
    const target = cloneElements[index];
    if (!target) return;
    const styles = window.getComputedStyle(element);
    for (const property of styles) {
      target.style.setProperty(
        property,
        styles.getPropertyValue(property),
        styles.getPropertyPriority(property),
      );
    }
  });
};

const loadSvgAsImage = (svg: string) => new Promise<HTMLImageElement>((resolve, reject) => {
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
  const image = new Image();
  image.onload = () => {
    URL.revokeObjectURL(url);
    resolve(image);
  };
  image.onerror = () => {
    URL.revokeObjectURL(url);
    reject(new Error("报价单图像生成失败"));
  };
  image.src = url;
});

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

export const renderQuoteToA4Images = async (element: HTMLElement, scale = 2) => {
  if (document.fonts?.ready) await document.fonts.ready;

  const bounds = element.getBoundingClientRect();
  const width = Math.ceil(Math.max(bounds.width, element.scrollWidth));
  const height = Math.ceil(Math.max(bounds.height, element.scrollHeight));
  if (!width || !height) throw new Error("报价单尚未完成排版");

  const clone = element.cloneNode(true) as HTMLElement;
  copyComputedStyles(element, clone);
  clone.setAttribute("xmlns", XHTML_NAMESPACE);
  clone.style.width = `${width}px`;
  clone.style.height = `${height}px`;
  clone.style.minHeight = "0";
  clone.style.margin = "0";
  clone.style.borderRadius = "0";
  clone.style.boxShadow = "none";
  await inlineImages(element, clone);

  const markup = new XMLSerializer().serializeToString(clone);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><foreignObject width="100%" height="100%">${markup}</foreignObject></svg>`;
  const image = await loadSvgAsImage(svg);
  const canvas = document.createElement("canvas");
  canvas.width = width * scale;
  canvas.height = height * scale;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("当前浏览器无法生成打印图像");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);

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
