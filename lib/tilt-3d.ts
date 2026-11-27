import type { PointerEvent } from "react";

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";
const POINTER_CENTER_RATIO = 0.5;
const POINTER_DOUBLE_SCALE = 2;
const PERCENT_SCALE = 100;
const RESET_TILT_DEG = 0;
const DEFAULT_POINTER_PERCENT = 50;

export const PLUGIN_CARD_MAX_TILT_DEG = 1;

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

/**
 * Updates CSS custom properties (--rx, --ry, --mx, --my) on a card element to
 * drive pointer-tracked 3D tilt and specular highlight effects.
 */
export function applyTiltVariables(
  element: HTMLElement,
  event: PointerEvent<HTMLElement>,
  maxTiltDeg: number = PLUGIN_CARD_MAX_TILT_DEG,
): void {
  if (prefersReducedMotion()) {
    return;
  }
  const rect = element.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) {
    return;
  }
  const ratioX = (event.clientX - rect.left) / rect.width;
  const ratioY = (event.clientY - rect.top) / rect.height;
  const rotateY = (ratioX - POINTER_CENTER_RATIO) * POINTER_DOUBLE_SCALE * maxTiltDeg;
  const rotateX = (POINTER_CENTER_RATIO - ratioY) * POINTER_DOUBLE_SCALE * maxTiltDeg;
  element.style.setProperty("--rx", `${rotateX.toFixed(2)}deg`);
  element.style.setProperty("--ry", `${rotateY.toFixed(2)}deg`);
  element.style.setProperty("--mx", `${(ratioX * PERCENT_SCALE).toFixed(1)}%`);
  element.style.setProperty("--my", `${(ratioY * PERCENT_SCALE).toFixed(1)}%`);
}

/**
 * Resets pointer-tracked 3D tilt CSS custom properties back to neutral.
 */
export function resetTiltVariables(element: HTMLElement): void {
  element.style.setProperty("--rx", `${RESET_TILT_DEG}deg`);
  element.style.setProperty("--ry", `${RESET_TILT_DEG}deg`);
  element.style.setProperty("--mx", `${DEFAULT_POINTER_PERCENT}%`);
  element.style.setProperty("--my", `${DEFAULT_POINTER_PERCENT}%`);
}
