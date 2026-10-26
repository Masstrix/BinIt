import { useMemo } from "react";
import qrcode from "qrcode-generator";

/** A scannable QR code for `url`, on a light tile so it reads over any background. */
export function QrCode({ url, size = 120 }: { url: string | null | undefined; size?: number }) {
  const svg = useMemo(() => {
    if (!url) return null;
    const q = qrcode(0, "M");
    q.addData(url);
    q.make();
    return q.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
  }, [url]);

  return (
    <div
      style={{ width: size, height: size, borderRadius: 18, background: "#e8ebf4", padding: 6, flex: "none", display: "grid", placeItems: "center", color: "var(--bg)", fontSize: 12 }}
      role="img"
      aria-label={url ? `QR code for ${url}` : "No network address"}
      dangerouslySetInnerHTML={svg ? { __html: svg } : undefined}
    >
      {svg ? undefined : "No address"}
    </div>
  );
}
