import { renderAiredMark } from "@/lib/branding/aired-mark";

// Browser-tab / address-bar icon. Next emits the matching <link rel="icon">
// automatically. 192×192 keeps it crisp on hi-dpi tabs and as the Chrome
// site-tile when the manifest icons haven't loaded yet.

export const size = { width: 192, height: 192 };
export const contentType = "image/png";

export default function Icon() {
  return renderAiredMark(size.width);
}
