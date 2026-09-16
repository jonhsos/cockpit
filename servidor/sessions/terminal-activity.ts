/**
 * Distinguishes real agent output from terminal keepalive / CSI chatter.
 * Antigravity (agy) and other TUIs emit DA/DSR probes that must not mark a pane "working".
 */

const CSI = /\x1b\[[\x30-\x3f]*[\x20-\x2f]*[\x40-\x7e]/g;
const OSC = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;
const DCS = /\x1bP[\s\S]*?(?:\x1b\\|\x07)/g;
const CHARSET = /\x1b[()][0-2AB]/g;
const ESC_OTHER = /\x1b./g;
/** Leftover device-attribute fragments when the ESC byte landed in a previous chunk. */
const DA_LEFTOVER = /[>?][0-9;]*[a-zA-Z]/g;
const C0 = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g;

export function stripTerminalControls(data: string): string {
  return data
    .replace(OSC, "")
    .replace(DCS, "")
    .replace(CSI, "")
    .replace(CHARSET, "")
    .replace(ESC_OTHER, "")
    .replace(DA_LEFTOVER, "")
    .replace(C0, "");
}

export function hasSignificantTerminalOutput(data: string): boolean {
  return stripTerminalControls(data).replace(/[\r\n\t ]+/g, "").length > 0;
}
