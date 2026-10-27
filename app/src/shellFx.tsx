import type { ReactNode } from "react";

/**
 * The seven Legendary shells in motion: the layers each one adds to the helmet. Generated from the "Legendary shells in
 * motion" board of the design canvas (Cosmetics-Motion), so change the design and regenerate rather than editing by hand.
 * Every element is SMIL (`animate`), so it needs no script and Helmet freezes it with `pauseAnimations()` where a still
 * frame is wanted (small helmets, reduced motion).
 *
 * `u` is a per-helmet prefix that keeps the ids of several helmets on one page apart.
 */
export interface ShellFx {
  /** What the shell is filled with (a gradient these defs make, or a plain colour). */
  fill: string;
  /** Gradients and the like the layers use. */
  defs: ReactNode;
  /** Behind the shell (an aura). */
  back: ReactNode;
  /** On the shell, clipped to its outline; under the stripe, decal and number. */
  clip: ReactNode;
  /** In front of everything but kept off the face (particles, glints, an outline pulse). */
  front: ReactNode;
}

export const SHELL_FX: Record<string, (u: string) => ShellFx> = {
  gold: (u) => ({
    fill: `url(#${u}-g-gold)`,
    defs: (
      <>
        <linearGradient id={`${u}-g-gold`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#FFE48A" />
          <stop offset="0.5" stopColor="#FFC93C" />
          <stop offset="1" stopColor="#B8750F" />
        </linearGradient>
        <radialGradient id={`${u}-gold-aura`}>
          <stop offset="0" stopColor="#FFE48A" stopOpacity="0.95" />
          <stop offset="0.5" stopColor="#FFC93C" stopOpacity="0.45" />
          <stop offset="1" stopColor="#FFC93C" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${u}-shine-g`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#FFFFFF" stopOpacity="0" />
          <stop offset="0.5" stopColor="#FFFFFF" stopOpacity="0.85" />
          <stop offset="1" stopColor="#FFFFFF" stopOpacity="0" />
        </linearGradient>
      </>
    ),
    back: (
      <>
        <circle cx="27" cy="24" r="21" fill={`url(#${u}-gold-aura)`} opacity="0.7">
          <animate attributeName="opacity" values="0.65;1;0.65" dur="2.4s" repeatCount="indefinite" />
          <animate attributeName="r" values="19.5;21;19.5" dur="2.4s" repeatCount="indefinite" />
        </circle>
      </>
    ),
    clip: (
      <>
        <g clipPath={`url(#${u}-c-shell)`}>
          <g transform="rotate(24 28 24)">
            <rect x="0" y="-14" width="9" height="76" fill={`url(#${u}-shine-g)`}>
              <animateTransform attributeName="transform" type="translate" values="-16 0;58 0;58 0" keyTimes="0;0.4;1" dur="3.6s" repeatCount="indefinite" />
            </rect>
          </g>
          <path d="M38 9.6l.9 2.3 2.3.9-2.3.9-.9 2.3-.9-2.3-2.3-.9 2.3-.9z" fill="#FFFFFF" opacity="0">
            <animate attributeName="opacity" values="0;0;1;0;0" keyTimes="0;0.38;0.46;0.58;1" dur="3.6s" repeatCount="indefinite" />
          </path>
          <path d="M14.4 28.4l.6 1.5 1.5.6-1.5.6-.6 1.5-.6-1.5-1.5-.6 1.5-.6z" fill="#FFFFFF" opacity="0">
            <animate attributeName="opacity" values="0;0;1;0;0" keyTimes="0;0.42;0.5;0.62;1" dur="3.6s" repeatCount="indefinite" />
          </path>
        </g>
      </>
    ),
    front: (
      <>
        <path d="M11.2 34C7.4 26.4 8 15.6 15.6 10.2C21.6 6 31.6 5.6 38 9C43 11.8 46.2 17 46.6 23L46.6 31.4C46.6 36.4 44.6 39.6 40.8 40L13.4 35.6C12.4 35.4 11.6 34.8 11.2 34Z" fill="none" stroke="#FFF1B0" strokeWidth="0.7" opacity="0.3">
          <animate attributeName="opacity" values="0.15;0.75;0.15" dur="2.4s" repeatCount="indefinite" />
        </path>
        <circle cx="9" cy="34" r="0.6" fill="#FFE48A" opacity="0">
          <animate attributeName="opacity" values="0;1;0.8;0" keyTimes="0;0.25;0.7;1" dur="3.0s" begin="-0.0s" repeatCount="indefinite" />
          <animateTransform attributeName="transform" type="translate" values="0 0;1.2 -16" dur="3.0s" begin="-0.0s" repeatCount="indefinite" />
        </circle>
        <circle cx="20" cy="40" r="0.5" fill="#FFF6CF" opacity="0">
          <animate attributeName="opacity" values="0;1;0.8;0" keyTimes="0;0.25;0.7;1" dur="2.6s" begin="-0.4s" repeatCount="indefinite" />
          <animateTransform attributeName="transform" type="translate" values="0 0;-1.2 -16" dur="2.6s" begin="-0.4s" repeatCount="indefinite" />
        </circle>
        <circle cx="33" cy="41" r="0.7" fill="#FFE48A" opacity="0">
          <animate attributeName="opacity" values="0;1;0.8;0" keyTimes="0;0.25;0.7;1" dur="3.4s" begin="-0.8s" repeatCount="indefinite" />
          <animateTransform attributeName="transform" type="translate" values="0 0;1.2 -16" dur="3.4s" begin="-0.8s" repeatCount="indefinite" />
        </circle>
        <circle cx="44" cy="36" r="0.5" fill="#FFF6CF" opacity="0">
          <animate attributeName="opacity" values="0;1;0.8;0" keyTimes="0;0.25;0.7;1" dur="2.8s" begin="-1.2s" repeatCount="indefinite" />
          <animateTransform attributeName="transform" type="translate" values="0 0;-1.2 -16" dur="2.8s" begin="-1.2s" repeatCount="indefinite" />
        </circle>
        <circle cx="6" cy="22" r="0.45" fill="#FFE48A" opacity="0">
          <animate attributeName="opacity" values="0;1;0.8;0" keyTimes="0;0.25;0.7;1" dur="3.2s" begin="-1.6s" repeatCount="indefinite" />
          <animateTransform attributeName="transform" type="translate" values="0 0;1.2 -16" dur="3.2s" begin="-1.6s" repeatCount="indefinite" />
        </circle>
        <circle cx="47" cy="18" r="0.55" fill="#FFF6CF" opacity="0">
          <animate attributeName="opacity" values="0;1;0.8;0" keyTimes="0;0.25;0.7;1" dur="3.0s" begin="-2.0s" repeatCount="indefinite" />
          <animateTransform attributeName="transform" type="translate" values="0 0;-1.2 -16" dur="3.0s" begin="-2.0s" repeatCount="indefinite" />
        </circle>
        <circle cx="26" cy="42" r="0.4" fill="#FFF6CF" opacity="0">
          <animate attributeName="opacity" values="0;1;0.8;0" keyTimes="0;0.25;0.7;1" dur="2.4s" begin="-2.4s" repeatCount="indefinite" />
          <animateTransform attributeName="transform" type="translate" values="0 0;1.2 -16" dur="2.4s" begin="-2.4s" repeatCount="indefinite" />
        </circle>
        <circle cx="39" cy="40" r="0.45" fill="#FFE48A" opacity="0">
          <animate attributeName="opacity" values="0;1;0.8;0" keyTimes="0;0.25;0.7;1" dur="3.6s" begin="-2.8s" repeatCount="indefinite" />
          <animateTransform attributeName="transform" type="translate" values="0 0;-1.2 -16" dur="3.6s" begin="-2.8s" repeatCount="indefinite" />
        </circle>
        <path d="M5 9.2L5.45 10.55L6.8 11L5.45 11.45L5 12.8L4.55 11.45L3.2 11L4.55 10.55Z" fill="#FFF6CF" opacity="0">
          <animate attributeName="opacity" values="0;0;1;0;0" keyTimes="0;0.3;0.45;0.6;1" dur="2.2s" begin="-0.0s" repeatCount="indefinite" />
        </path>
        <path d="M46 3.8L46.55 5.45L48.2 6L46.55 6.55L46 8.2L45.45 6.55L43.8 6L45.45 5.45Z" fill="#FFF6CF" opacity="0">
          <animate attributeName="opacity" values="0;0;1;0;0" keyTimes="0;0.3;0.45;0.6;1" dur="2.6s" begin="-0.5s" repeatCount="indefinite" />
        </path>
        <path d="M3 30.6L3.35 31.65L4.4 32L3.35 32.35L3 33.4L2.65 32.35L1.6 32L2.65 31.65Z" fill="#FFF6CF" opacity="0">
          <animate attributeName="opacity" values="0;0;1;0;0" keyTimes="0;0.3;0.45;0.6;1" dur="2.0s" begin="-1.0s" repeatCount="indefinite" />
        </path>
        <path d="M47 38.4L47.40 39.60L48.6 40L47.40 40.40L47 41.6L46.60 40.40L45.4 40L46.60 39.60Z" fill="#FFF6CF" opacity="0">
          <animate attributeName="opacity" values="0;0;1;0;0" keyTimes="0;0.3;0.45;0.6;1" dur="2.4s" begin="-1.5s" repeatCount="indefinite" />
        </path>
        <path d="M24 1.6L24.35 2.65L25.4 3L24.35 3.35L24 4.4L23.65 3.35L22.6 3L23.65 2.65Z" fill="#FFF6CF" opacity="0">
          <animate attributeName="opacity" values="0;0;1;0;0" keyTimes="0;0.3;0.45;0.6;1" dur="2.8s" begin="-2.0s" repeatCount="indefinite" />
        </path>
      </>
    ),
  }),
  holo: (u) => ({
    fill: `url(#${u}-g-holo)`,
    defs: (
      <>
        <linearGradient id={`${u}-g-holo`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#FFE48A">
            <animate attributeName="stop-color" values="#FFE48A;#8BE9FF;#E7A6FF;#FFE48A" dur="6s" repeatCount="indefinite" />
          </stop>
          <stop offset="0.5" stopColor="#8BE9FF">
            <animate attributeName="stop-color" values="#8BE9FF;#E7A6FF;#FFE48A;#8BE9FF" dur="6s" repeatCount="indefinite" />
          </stop>
          <stop offset="1" stopColor="#E7A6FF">
            <animate attributeName="stop-color" values="#E7A6FF;#FFE48A;#8BE9FF;#E7A6FF" dur="6s" repeatCount="indefinite" />
          </stop>
        </linearGradient>
        <linearGradient id={`${u}-shine-g`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#FFFFFF" stopOpacity="0" />
          <stop offset="0.5" stopColor="#FFFFFF" stopOpacity="0.85" />
          <stop offset="1" stopColor="#FFFFFF" stopOpacity="0" />
        </linearGradient>
      </>
    ),
    back: null,
    clip: (
      <>
        <g clipPath={`url(#${u}-c-shell)`} opacity="0.5">
          <g transform="rotate(24 28 24)">
            <rect x="0" y="-14" width="7" height="76" fill={`url(#${u}-shine-g)`}>
              <animateTransform attributeName="transform" type="translate" values="-16 0;58 0;58 0" keyTimes="0;0.4;1" dur="6s" repeatCount="indefinite" />
            </rect>
          </g>
        </g>
      </>
    ),
    front: null,
  }),
  nightsky: (u) => ({
    fill: `url(#${u}-g-night)`,
    defs: (
      <>
        <linearGradient id={`${u}-g-night`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#0B1026" />
          <stop offset="0.333" stopColor="#1B2A6B" />
          <stop offset="0.667" stopColor="#5B3FD4" />
          <stop offset="1" stopColor="#B07CFF" />
        </linearGradient>
      </>
    ),
    back: null,
    clip: (
      <>
        <g clipPath={`url(#${u}-c-shell)`} fill="#FFFFFF">
          <circle cx="17" cy="15" r="0.5">
            <animate attributeName="opacity" values="0.2;1;0.2" dur="2.4s" repeatCount="indefinite" />
          </circle>
          <circle cx="23" cy="11" r="0.45">
            <animate attributeName="opacity" values="0.2;1;0.2" dur="2.4s" begin="-0.8s" repeatCount="indefinite" />
          </circle>
          <circle cx="14" cy="24" r="0.5">
            <animate attributeName="opacity" values="0.2;1;0.2" dur="2.4s" begin="-1.5s" repeatCount="indefinite" />
          </circle>
          <circle cx="20" cy="29" r="0.4">
            <animate attributeName="opacity" values="0.2;1;0.2" dur="2.4s" begin="-0.4s" repeatCount="indefinite" />
          </circle>
          <circle cx="34" cy="36" r="0.45">
            <animate attributeName="opacity" values="0.2;1;0.2" dur="2.4s" begin="-1.9s" repeatCount="indefinite" />
          </circle>
          <path d="M34 9.6L26.4 13.4" stroke="#FFFFFF" strokeWidth="0.9" strokeLinecap="round" fill="none" opacity="0">
            <animate attributeName="opacity" values="0;0;1;0;0" keyTimes="0;0.7;0.73;0.86;1" dur="5s" repeatCount="indefinite" />
            <animateTransform attributeName="transform" type="translate" values="0 0;0 0;-18 9;-18 9" keyTimes="0;0.7;0.86;1" dur="5s" repeatCount="indefinite" />
          </path>
        </g>
      </>
    ),
    front: null,
  }),
  inferno: (u) => ({
    fill: `url(#${u}-g-inf)`,
    defs: (
      <>
        <linearGradient id={`${u}-g-inf`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#FFE48A" />
          <stop offset="0.333" stopColor="#FF8A1F" />
          <stop offset="0.667" stopColor="#E4231F" />
          <stop offset="1" stopColor="#6B0F1A" />
        </linearGradient>
      </>
    ),
    back: null,
    clip: (
      <>
        <g clipPath={`url(#${u}-c-shell)`}>
          <rect x="0" y="0" width="48" height="48" fill="#FFE48A" opacity="0">
            <animate attributeName="opacity" values="0;0.18;0.05;0.22;0.06;0" keyTimes="0;0.2;0.35;0.55;0.75;1" dur="1.3s" repeatCount="indefinite" />
          </rect>
          <circle cx="16" cy="33" r="0.6" fill="#FFE48A" opacity="0">
            <animate attributeName="opacity" values="0;1;0" keyTimes="0;0.15;1" dur="1.8s" repeatCount="indefinite" />
            <animateTransform attributeName="transform" type="translate" values="0 0;1 -16" dur="1.8s" repeatCount="indefinite" />
          </circle>
          <circle cx="22" cy="35" r="0.5" fill="#FFD23F" opacity="0">
            <animate attributeName="opacity" values="0;1;0" keyTimes="0;0.15;1" dur="1.8s" begin="-0.5s" repeatCount="indefinite" />
            <animateTransform attributeName="transform" type="translate" values="0 0;1 -16" dur="1.8s" begin="-0.5s" repeatCount="indefinite" />
          </circle>
          <circle cx="28" cy="36.5" r="0.6" fill="#FFE48A" opacity="0">
            <animate attributeName="opacity" values="0;1;0" keyTimes="0;0.15;1" dur="1.8s" begin="-1.1s" repeatCount="indefinite" />
            <animateTransform attributeName="transform" type="translate" values="0 0;1 -16" dur="1.8s" begin="-1.1s" repeatCount="indefinite" />
          </circle>
          <circle cx="35" cy="37.5" r="0.5" fill="#FFD23F" opacity="0">
            <animate attributeName="opacity" values="0;1;0" keyTimes="0;0.15;1" dur="1.8s" begin="-0.8s" repeatCount="indefinite" />
            <animateTransform attributeName="transform" type="translate" values="0 0;1 -16" dur="1.8s" begin="-0.8s" repeatCount="indefinite" />
          </circle>
          <circle cx="12.5" cy="28" r="0.5" fill="#FFE48A" opacity="0">
            <animate attributeName="opacity" values="0;1;0" keyTimes="0;0.15;1" dur="1.8s" begin="-1.4s" repeatCount="indefinite" />
            <animateTransform attributeName="transform" type="translate" values="0 0;1 -16" dur="1.8s" begin="-1.4s" repeatCount="indefinite" />
          </circle>
        </g>
      </>
    ),
    front: null,
  }),
  nebula: (u) => ({
    fill: "#C2409B",
    defs: (
      <>
        <linearGradient id={`${u}-g-neb`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#2A1B6B" />
          <stop offset="0.333" stopColor="#C2409B" />
          <stop offset="0.667" stopColor="#FF8A4C" />
          <stop offset="1" stopColor="#FFE48A" />
        </linearGradient>
      </>
    ),
    back: null,
    clip: (
      <>
        <g clipPath={`url(#${u}-c-shell)`}>
          <rect x="-12" y="-16" width="80" height="80" fill={`url(#${u}-g-neb)`}>
            <animateTransform attributeName="transform" type="rotate" values="0 28 24;360 28 24" dur="16s" repeatCount="indefinite" />
          </rect>
          <ellipse cx="20" cy="20" rx="8" ry="4" fill="#FFB3E6" opacity="0.28">
            <animateTransform attributeName="transform" type="translate" values="0 0;7 0;0 0" dur="7s" repeatCount="indefinite" />
          </ellipse>
          <ellipse cx="30" cy="33" rx="9" ry="3.4" fill="#2A1B6B" opacity="0.3">
            <animateTransform attributeName="transform" type="translate" values="7 0;0 0;7 0" dur="7s" repeatCount="indefinite" />
          </ellipse>
        </g>
      </>
    ),
    front: null,
  }),
  glacier: (u) => ({
    fill: `url(#${u}-g-gla)`,
    defs: (
      <>
        <linearGradient id={`${u}-g-gla`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#E8F7FF" />
          <stop offset="0.333" stopColor="#8BE9FF" />
          <stop offset="0.667" stopColor="#4DA3FF" />
          <stop offset="1" stopColor="#2A3F8F" />
        </linearGradient>
        <linearGradient id={`${u}-frost-g`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#E8F7FF" stopOpacity="0" />
          <stop offset="0.5" stopColor="#FFFFFF" stopOpacity="0.7" />
          <stop offset="1" stopColor="#E8F7FF" stopOpacity="0" />
        </linearGradient>
      </>
    ),
    back: null,
    clip: (
      <>
        <g clipPath={`url(#${u}-c-shell)`}>
          <g transform="rotate(24 28 24)">
            <rect x="0" y="-14" width="12" height="76" fill={`url(#${u}-frost-g)`}>
              <animateTransform attributeName="transform" type="translate" values="-16 0;58 0;58 0" keyTimes="0;0.4;1" dur="6s" repeatCount="indefinite" />
            </rect>
          </g>
          <path d="M17 13.4l.6 1.6 1.6.6-1.6.6-.6 1.6-.6-1.6-1.6-.6 1.6-.6z" fill="#FFFFFF" opacity="0">
            <animate attributeName="opacity" values="0;0;1;0;0" keyTimes="0;0.38;0.46;0.58;1" dur="6s" repeatCount="indefinite" />
          </path>
          <path d="M28 31.4l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z" fill="#FFFFFF" opacity="0">
            <animate attributeName="opacity" values="0;0;1;0;0" keyTimes="0;0.44;0.52;0.64;1" dur="6s" repeatCount="indefinite" />
          </path>
          <path d="M40 11.4l.5 1.3 1.3.5-1.3.5-.5 1.3-.5-1.3-1.3-.5 1.3-.5z" fill="#FFFFFF" opacity="0">
            <animate attributeName="opacity" values="0;0;1;0;0" keyTimes="0;0.5;0.58;0.7;1" dur="6s" repeatCount="indefinite" />
          </path>
        </g>
      </>
    ),
    front: null,
  }),
  galaxy: (u) => ({
    fill: `url(#${u}-g-gal)`,
    defs: (
      <>
        <linearGradient id={`${u}-g-gal`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#04020D" />
          <stop offset="0.333" stopColor="#150A33" />
          <stop offset="0.667" stopColor="#3B1B8C" />
          <stop offset="1" stopColor="#7A3FD6" />
        </linearGradient>
      </>
    ),
    back: null,
    clip: (
      <>
        <g clipPath={`url(#${u}-c-shell)`}>
          <ellipse cx="28" cy="24" rx="16" ry="4" fill="#7A3FD6" opacity="0.25">
            <animateTransform attributeName="transform" type="rotate" values="0 28 24;360 28 24" dur="30s" repeatCount="indefinite" />
          </ellipse>
          <g fill="#FFFFFF">
            <circle cx="16" cy="14" r="0.55">
              <animate attributeName="opacity" values="0.2;1;0.2" dur="2.4s" repeatCount="indefinite" />
            </circle>
            <circle cx="22" cy="10" r="0.55">
              <animate attributeName="opacity" values="0.2;1;0.2" dur="2.4s" begin="-1.1s" repeatCount="indefinite" />
            </circle>
            <path d="M30 7.2L30.45 8.55L31.8 9L30.45 9.45L30 10.8L29.55 9.45L28.2 9L29.55 8.55Z">
              <animate attributeName="opacity" values="0.2;1;0.2" dur="2.4s" begin="-0.4s" repeatCount="indefinite" />
            </path>
            <circle cx="37" cy="11" r="0.55">
              <animate attributeName="opacity" values="0.2;1;0.2" dur="2.4s" begin="-1.7s" repeatCount="indefinite" />
            </circle>
            <circle cx="14" cy="22" r="0.55">
              <animate attributeName="opacity" values="0.2;1;0.2" dur="2.4s" begin="-0.7s" repeatCount="indefinite" />
            </circle>
            <path d="M19 24.8L19.55 26.45L21.2 27L19.55 27.55L19 29.2L18.45 27.55L16.8 27L18.45 26.45Z">
              <animate attributeName="opacity" values="0.2;1;0.2" dur="2.4s" begin="-1.3s" repeatCount="indefinite" />
            </path>
            <circle cx="26" cy="32" r="0.55">
              <animate attributeName="opacity" values="0.2;1;0.2" dur="2.4s" begin="-0.2s" repeatCount="indefinite" />
            </circle>
            <circle cx="33" cy="35" r="0.55">
              <animate attributeName="opacity" values="0.2;1;0.2" dur="2.4s" begin="-1.9s" repeatCount="indefinite" />
            </circle>
            <path d="M41 31.2L41.45 32.55L42.8 33L41.45 33.45L41 34.8L40.55 33.45L39.2 33L40.55 32.55Z">
              <animate attributeName="opacity" values="0.2;1;0.2" dur="2.4s" begin="-0.9s" repeatCount="indefinite" />
            </path>
            <circle cx="44" cy="27" r="0.55">
              <animate attributeName="opacity" values="0.2;1;0.2" dur="2.4s" begin="-1.5s" repeatCount="indefinite" />
            </circle>
            <circle cx="21" cy="19" r="0.55">
              <animate attributeName="opacity" values="0.2;1;0.2" dur="2.4s" begin="-0.5s" repeatCount="indefinite" />
            </circle>
            <circle cx="12" cy="30" r="0.55">
              <animate attributeName="opacity" values="0.2;1;0.2" dur="2.4s" begin="-2.1s" repeatCount="indefinite" />
            </circle>
            <circle cx="28" cy="14" r="0.55">
              <animate attributeName="opacity" values="0.2;1;0.2" dur="2.4s" begin="-1.2s" repeatCount="indefinite" />
            </circle>
            <circle cx="35" cy="38" r="0.55">
              <animate attributeName="opacity" values="0.2;1;0.2" dur="2.4s" begin="-0.6s" repeatCount="indefinite" />
            </circle>
          </g>
        </g>
      </>
    ),
    front: null,
  }),
};
