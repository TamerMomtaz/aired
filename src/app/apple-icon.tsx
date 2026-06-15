import { renderAiredMark } from "@/lib/branding/aired-mark";

// iOS home-screen icon. iOS ignores the manifest's icons array entirely for
// "Add to Home Screen" and reads <link rel="apple-touch-icon"> instead — Next
// emits it automatically from this file. 180×180 is the canonical iPhone size
// (iOS scales it down for older devices). No safe-zone padding: iOS applies its
// own rounded-corner mask and clipping past that is fine.

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return renderAiredMark(size.width);
}
