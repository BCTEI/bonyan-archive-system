// Code128 "Full ASCII" (FNC4 byte-mode) encoder.
//
// Standard Code128, and every JS barcode library built on it (including
// JsBarcode — see its CODE128.js `valid()` regex, which is `[\x00-\x7F...]`),
// can only represent ASCII byte values 0-127. Arabic reference numbers
// (م.ب/…) are multi-byte UTF-8, and every one of those bytes is >= 128, so
// they cannot be represented by a plain Code128 symbol at all — this is a
// hard limitation of the symbology, not a bug in any particular library.
//
// The AIM/ISO Code128 spec defines FNC4 specifically to lift this: a single
// FNC4 shifts the *next* symbol's value up by 128 (representing byte values
// 128-255), and *two consecutive* FNC4s latch that shift on/off for every
// symbol until toggled again. This is exactly how "Code128 Full ASCII" /
// "UTF-8" modes on programmable scanners (Honeywell, Zebra, Datalogic, …)
// interpret incoming symbols — which is the mechanism this encoder targets.
// The barcode payload produced here is the literal UTF-8 byte sequence of
// the input string; nothing is transliterated or approximated.
//
// A scanner must have its Code128 character-set/code-page setting on
// "Full ASCII" / "UTF-8" for this to decode back to the original text —
// most enterprise 1D scanners support this, but it is commonly off by
// default and may need a one-time configuration barcode from the scanner's
// manual.

// Standard Code128 bar-width pattern table (index = symbol value 0-102,
// 103/104/105 = Start A/B/C, 106 = Stop). Each entry's decimal digits are
// literally its module pattern (1 = bar, 0 = space) — this table is the
// public ISO/IEC 15417 symbol table, not specific to any library.
const BARS: number[] = [
  11011001100, 11001101100, 11001100110, 10010011000, 10010001100,
  10001001100, 10011001000, 10011000100, 10001100100, 11001001000,
  11001000100, 11000100100, 10110011100, 10011011100, 10011001110,
  10111001100, 10011101100, 10011100110, 11001110010, 11001011100,
  11001001110, 11011100100, 11001110100, 11101101110, 11101001100,
  11100101100, 11100100110, 11101100100, 11100110100, 11100110010,
  11011011000, 11011000110, 11000110110, 10100011000, 10001011000,
  10001000110, 10110001000, 10001101000, 10001100010, 11010001000,
  11000101000, 11000100010, 10110111000, 10110001110, 10001101110,
  10111011000, 10111000110, 10001110110, 11101110110, 11010001110,
  11000101110, 11011101000, 11011100010, 11011101110, 11101011000,
  11101000110, 11100010110, 11101101000, 11101100010, 11100011010,
  11101111010, 11001000010, 11110001010, 10100110000, 10100001100,
  10010110000, 10010000110, 10000101100, 10000100110, 10110010000,
  10110000100, 10011010000, 10011000010, 10000110100, 10000110010,
  11000010010, 11001010000, 11110111010, 11000010100, 10001111010,
  10100111100, 10010111100, 10010011110, 10111100100, 10011110100,
  10011110010, 11110100100, 11110010100, 11110010010, 11011011110,
  11011110110, 11110110110, 10101111000, 10100011110, 10001011110,
  10111101000, 10111100010, 11110101000, 11110100010, 10111011110,
  10111101110, 11101011110, 11110101110, 11010000100, 11010010000,
  11010011100, 1100011101011
];

const START_B = 104;
const STOP = 106;
const MODULO = 103;

type CodeSet = 'A' | 'B';

/** Builds the full 0/1 module string for a Code128 Full-ASCII (FNC4) barcode encoding `text`'s raw UTF-8 bytes. */
export function buildCode128Fnc4Modules(text: string): string {
  const bytes = Array.from(new TextEncoder().encode(text));

  let currentSet: CodeSet = 'B';
  let currentUpper = false;
  const symbols: number[] = [];

  for (const raw of bytes) {
    const needUpper = raw >= 128;
    const base = needUpper ? raw - 128 : raw;

    if (needUpper !== currentUpper) {
      const fnc4Value = currentSet === 'A' ? 101 : 100;
      symbols.push(fnc4Value, fnc4Value);
      currentUpper = needUpper;
    }

    let requiredSet: CodeSet | null = null;
    if (base < 32) requiredSet = 'A';
    else if (base > 95) requiredSet = 'B';

    if (requiredSet && requiredSet !== currentSet) {
      const switchValue = currentSet === 'A' ? 100 : 101;
      symbols.push(switchValue);
      currentSet = requiredSet;
    }

    const value = currentSet === 'A'
      ? (base < 32 ? base + 64 : base - 32)
      : base - 32;
    symbols.push(value);
  }

  let checksum = START_B;
  symbols.forEach((v, i) => { checksum += v * (i + 1); });
  checksum = checksum % MODULO;

  const allValues = [START_B, ...symbols, checksum, STOP];
  return allValues.map(v => BARS[v].toString()).join('');
}

/**
 * Reference decoder for `buildCode128Fnc4Modules` — walks the same symbol
 * table/state machine in reverse to reconstruct the original text from a
 * module string. Used only by the self-check in the barcode service; a real
 * scanner performs the equivalent decoding in firmware.
 */
export function decodeCode128Fnc4Modules(modules: string): string {
  const widthToValue = new Map<string, number>();
  BARS.forEach((n, i) => widthToValue.set(n.toString(), i));

  const values: number[] = [];
  let i = 0;
  // First symbol (start code) and all body/checksum symbols are 11 modules;
  // the final Stop symbol is 13.
  while (i < modules.length) {
    const remaining = modules.length - i;
    const len = remaining === 13 ? 13 : 11;
    const chunk = modules.slice(i, i + len);
    const value = widthToValue.get(chunk);
    if (value === undefined) throw new Error('Unrecognized Code128 module pattern at offset ' + i);
    values.push(value);
    i += len;
  }

  // Drop start code, checksum, and stop — decode the body only.
  const body = values.slice(1, values.length - 2);

  let currentSet: CodeSet = 'B';
  let upper = false;
  const bytes: number[] = [];

  // FNC4 is only ever emitted by the encoder in pairs (a latch toggle), so a
  // lone FNC4 is never expected here — each pair consumes two symbols and
  // flips `upper` exactly once.
  let idx = 0;
  while (idx < body.length) {
    const v = body[idx];
    const isFnc4 = (currentSet === 'A' && v === 101) || (currentSet === 'B' && v === 100);
    if (isFnc4) {
      upper = !upper;
      idx += 2;
      continue;
    }

    const isSwitchToA = currentSet === 'B' && v === 101;
    const isSwitchToB = currentSet === 'A' && v === 100;
    if (isSwitchToA) { currentSet = 'A'; idx += 1; continue; }
    if (isSwitchToB) { currentSet = 'B'; idx += 1; continue; }

    const base = currentSet === 'A'
      ? (v < 64 ? v + 32 : v - 64)
      : v + 32;
    bytes.push(upper ? base + 128 : base);
    idx += 1;
  }

  return new TextDecoder('utf-8').decode(new Uint8Array(bytes));
}
