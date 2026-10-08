// Runtime brand marks, at the fidelity their owners actually ship.
//
// These live apart from `views/icons.ts` on purpose. That file stores a single
// path per icon in one 24x24 box, which is right for lucide line icons and wrong
// for a brand mark: Codex is a gradient, Antigravity is seven coloured blobs,
// Claude is a single warm shape. Flattening them into one path each is what left
// OpenCode rendering as a bare grey square and made Antigravity indistinguishable
// from a placeholder.
//
// Each entry is the owner's own artwork, transcribed. Colours are the brand's,
// not a palette chosen to fit the panel — the panel is neutral on purpose, so a
// runtime is the one place a colour is allowed to mean something.
//
// `MONO` is the flat single-colour fallback for the places that cannot carry a
// multi-path mark: it is the owner's shape in their brand colour, used at sizes
// where six gradients would turn to mud.

export interface RuntimeMark {
  /** Full mark, own viewBox. Multi-path and/or gradient. */
  art: string;
  viewBox: string;
  /** The brand colour: the accent a pill border, a ring or a dot should use. */
  color: string;
  /** Flat fallback in `color`, same geometry, one path. */
  mono: string;
}

export const RUNTIME_MARKS: Record<string, RuntimeMark> = {
  antigravity: {
    // The owner's mark, in their brand blue. The multi-blob lockup is legible
    // only above roughly 32px; the session row renders this at 15px, where the
    // blobs collapse into noise and the runtime is indistinguishable from
    // OpenCode. The silhouette is the same geometry the blobs describe, so the
    // runtime stays recognisable at every size the island actually uses.
    art: `<path d="M12.006 3.02q1.736-.02 2.682 1.303.945 1.323 1.648 2.985.612 1.46 1.212 3.288.6 1.829 1.256 3.683.65 1.779 1.387 3.342.736 1.564 1.703 2.643.123.148.118.323t-.13.284q-.142.129-.31.135t-.31-.117q-1.745-1.627-2.933-3.434-1.189-1.807-2.296-3.02-.85-.95-1.823-1.51-.972-.56-2.204-.54-1.233-.02-2.205.54t-1.822 1.51q-1.108 1.213-2.296 3.02T2.75 20.889q-.14.123-.31.117t-.311-.135q-.123-.11-.129-.284t.117-.323q.967-1.06 1.704-2.633t1.387-3.352q.655-1.854 1.255-3.683t1.212-3.288q.704-1.662 1.649-2.985t2.682-1.304" fill="#3186FF"/>`,
    viewBox: "0 0 24 24",
    color: "#3186FF",
    mono: "M12.006 3.02q1.736-.02 2.682 1.303.945 1.323 1.648 2.985.612 1.46 1.212 3.288.6 1.829 1.256 3.683.65 1.779 1.387 3.342.736 1.564 1.703 2.643.123.148.118.323t-.13.284q-.142.129-.31.135t-.31-.117q-1.745-1.627-2.933-3.434-1.189-1.807-2.296-3.02-.85-.95-1.823-1.51-.972-.56-2.204-.54-1.233-.02-2.205.54t-1.822 1.51q-1.108 1.213-2.296 3.02T2.75 20.889q-.14.123-.31.117t-.311-.135q-.123-.11-.129-.284t.117-.323q.967-1.06 1.704-2.633t1.387-3.352q.655-1.854 1.255-3.683t1.212-3.288q.704-1.662 1.649-2.985t2.682-1.304",
  },

  opencode: {
    art: `<g transform="matrix(1.5,0,0,1.5,-23.858,-7.25)"><path fill="#cfd8dc" d="M17.239 5.5v9.333h8V5.5zm2 2h4v5.333h-4z"/><rect width="4" height="3.334" x="19.239" y="9.5" fill="#607d8b" rx="0"/></g>`,
    viewBox: "0 0 16 16",
    color: "#cfd8dc",
    mono: "M3.4 2.5h9.2v9.2H3.4zm2 2v5.2h5.2V4.5z",
  },

codex: {
    // The owner's mark, one path in their brand orange. This replaces an
    // earlier transcription that filled almost its whole 16x16 box: even with
    // its missing gradient defined, it rendered as a solid rounded square, so
    // it was legible as "a square" and nothing else. One filled silhouette with
    // real negative space survives being drawn at 15px, which is the size the
    // session row uses.
    art: `<path fill="#ea580c" d="M10.75 2c1.557 0 2.643.525 3.346 1.08c.182.143.336.288.466.424c1.858-.595 4.214.236 5.473 2.416c.778 1.348.867 2.552.738 3.438a4.5 4.5 0 0 1-.133.609c1.394 1.264 1.87 3.595.771 5.716l-.127.232c-.778 1.347-1.776 2.027-2.607 2.36a4.5 4.5 0 0 1-.598.19C17.667 20.373 15.77 22 13.25 22c-1.556 0-2.643-.524-3.345-1.08a4.5 4.5 0 0 1-.468-.425c-1.792.574-4.047-.178-5.334-2.188l-.138-.227c-.778-1.348-.867-2.552-.738-3.438a4.4 4.4 0 0 1 .133-.61c-1.445-1.311-1.903-3.767-.645-5.947c.778-1.347 1.776-2.026 2.607-2.358a4.5 4.5 0 0 1 .597-.193C6.332 3.626 8.232 2 10.75 2m4.6 15.184l-.375.215h-.001v.001l-.002.001l-.008.005l-.032.018l-.12.07l-.438.252l-1.403.81l-2.105 1.212c.463.355 1.218.732 2.384.732c2.145 0 3.415-1.53 3.415-2.81v-5.132l-1.315-.76zm-6.165.307l-.375-.216h-.001l-.002-.002l-.008-.004l-.031-.018l-.121-.07l-.438-.252l-1.402-.81l-2.102-1.212c-.075.58-.02 1.42.56 2.423c1.071 1.857 3.032 2.19 4.14 1.55l2.817-1.624l1.402-.809l.226-.13v-1.518zM13.499 9l4.291 2.477l.375.215v5.17c.54-.226 1.24-.692 1.82-1.696c1.006-1.741.461-3.488-.523-4.226l-.202-.134l-2.817-1.624l-1.403-.81l-.225-.13zM5.835 7.138c-.54.225-1.24.693-1.82 1.698l-.002-.001c-1.071 1.856-.381 3.72.725 4.36l2.818 1.625l1.402.809l.226.13l1.315-.76l-4.289-2.475l-.375-.215zm4.315 3.795v2.132L12 14.134l1.85-1.068v-2.133L12 9.865zm.6-7.433c-2.144 0-3.414 1.53-3.415 2.81v5.131l1.315.758V6.817l.375-.216l.003-.002l.008-.004l.03-.019l.122-.07l.437-.252l1.403-.809l2.104-1.215c-.463-.355-1.218-.73-2.382-.73m7.986 3.17c-1.073-1.857-3.033-2.19-4.14-1.55h-.002l-2.816 1.624l-1.403.81l-.225.129V9.2l4.665-2.692l.375.217h.003l.008.005l.03.019l.12.07l.44.252l1.402.809l2.1 1.21c.075-.579.022-1.418-.557-2.42"/>`,
    viewBox: "0 0 24 24",
    color: "#ea580c",
    mono: "M10.75 2c1.557 0 2.643.525 3.346 1.08c.182.143.336.288.466.424c1.858-.595 4.214.236 5.473 2.416c.778 1.348.867 2.552.738 3.438a4.5 4.5 0 0 1-.133.609c1.394 1.264 1.87 3.595.771 5.716l-.127.232c-.778 1.347-1.776 2.027-2.607 2.36a4.5 4.5 0 0 1-.598.19C17.667 20.373 15.77 22 13.25 22c-1.556 0-2.643-.524-3.345-1.08a4.5 4.5 0 0 1-.468-.425c-1.792.574-4.047-.178-5.334-2.188l-.138-.227c-.778-1.348-.867-2.552-.738-3.438a4.4 4.4 0 0 1 .133-.61c-1.445-1.311-1.903-3.767-.645-5.947c.778-1.347 1.776-2.026 2.607-2.358a4.5 4.5 0 0 1 .597-.193C6.332 3.626 8.232 2 10.75 2",
  },

  claude: {
    art: `<path d="M447.957 233.579H512v66.176h-64v64.597h-31.723v62.315H384v-62.315h-31.723v62.315H320v-62.315H192v62.315h-32.256v-62.315H128v62.315H95.723v-62.315H64v-64.619H0V233.6h64V106.667h383.957v126.912zm-319.957 0h31.744v-60.736H128v60.736zm224.213 0H384v-60.736h-31.787v60.736z" fill="#d97757"/>`,
    viewBox: "0 0 512 512",
    color: "#d97757",
    mono: "M447.957 233.579H512v66.176h-64v64.597h-31.723v62.315H384v-62.315h-31.723v62.315H320v-62.315H192v62.315h-32.256v-62.315H128v62.315H95.723v-62.315H64v-64.619H0V233.6h64V106.667h383.957v126.912z",
  },
};

const ALIAS_TO_ID: Record<string, string> = {
  "claude-code": "claude",
  anthropic: "claude",
  claude_code: "claude",
  "claudecode": "claude",
  openai: "codex",
  "openai-codex": "codex",
  agy: "antigravity",
  antigravity_cli: "antigravity",
  "antigravity-cli": "antigravity",
  opencode_zen: "opencode",
};

export function markFor(runtime: string): RuntimeMark | null {
  const key = runtime.toLowerCase();
  const id = ALIAS_TO_ID[key] ?? key;
  return RUNTIME_MARKS[id] ?? null;
}

/** Brand colour for a runtime. Falls back to the neutral ink so an unknown CLI
 *  reads as unknown rather than confidently coloured. */
export function brandColor(runtime: string): string {
  return markFor(runtime)?.color ?? "#8e939c";
}

/** The mark as an inline SVG string. `ids` are suffixed per instance so two
 *  marks on screen at once — the picker and a session row — cannot collide on
 *  the same gradient id, which silently paints the second one wrong. */
export function markSvg(runtime: string, size: number, uid: string): string {
  const mark = markFor(runtime);
  if (!mark) return "";
  // The gradient id is rewritten rather than the markup duplicated, so the
  // artwork stays byte-identical to what its owner ships.
  const art = uid
    ? mark.art
        .replace(/id="codex-mark"/g, `id="codex-mark-${uid}"`)
        .replace(/url\(#codex-mark\)/g, `url(#codex-mark-${uid})`)
        .replace(/id="codex-clip"/g, `id="codex-clip-${uid}"`)
        .replace(/url\(#codex-clip\)/g, `url(#codex-clip-${uid})`)
    : mark.art;
  return `<svg width="${size}" height="${size}" viewBox="${mark.viewBox}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${art}</svg>`;
}
