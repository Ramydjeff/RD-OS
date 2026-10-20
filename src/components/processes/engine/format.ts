// printf / scanf formatting compatible with glibc for the common conversions.

import { blockString, fakeAddress, toNumber, type Value } from "./memory";

export interface FormatContext {
  warn: (message: string) => void;
}

function pad(body: string, width: number, left: boolean, zero: boolean, signLen = 0): string {
  if (body.length >= width) return body;
  if (left) return body + " ".repeat(width - body.length);
  if (zero) return body.slice(0, signLen) + "0".repeat(width - body.length) + body.slice(signLen);
  return " ".repeat(width - body.length) + body;
}

function expForm(n: number, prec: number, upper: boolean): string {
  let s = n.toExponential(prec);
  s = s.replace(/e([+-])(\d)$/, "e$10$2");
  return upper ? s.toUpperCase() : s;
}

function gForm(n: number, precIn: number, alt: boolean, upper: boolean): string {
  const prec = precIn === 0 ? 1 : precIn;
  if (n === 0) return alt ? (0).toFixed(prec - 1) : "0";
  const exp = Math.floor(Math.log10(Math.abs(Number(n.toExponential(prec - 1)))));
  let s: string;
  if (exp < -4 || exp >= prec) {
    s = expForm(n, prec - 1, upper);
    if (!alt) s = s.replace(/\.?0+([eE])/, "$1");
  } else {
    s = n.toFixed(Math.max(0, prec - 1 - exp));
    if (!alt && s.includes(".")) s = s.replace(/\.?0+$/, "");
  }
  return s;
}

/** Formats `fmt` with C semantics. Strings are read from char blocks. */
export function formatPrintf(fmt: string, args: Value[], ctx: FormatContext): string {
  let out = "";
  let ai = 0;
  const nextArg = (conv: string): Value | undefined => {
    const a = args[ai++];
    if (a === undefined) ctx.warn(`printf : argument manquant pour « %${conv} » (comportement indéfini, valeur aléatoire en vrai)`);
    return a;
  };

  for (let i = 0; i < fmt.length; i++) {
    const c = fmt[i]!;
    if (c !== "%") {
      out += c;
      continue;
    }
    let j = i + 1;
    if (fmt[j] === "%") {
      out += "%";
      i = j;
      continue;
    }
    let left = false;
    let plus = false;
    let space = false;
    let alt = false;
    let zero = false;
    while (j < fmt.length && "-+ #0".includes(fmt[j]!)) {
      const f = fmt[j]!;
      if (f === "-") left = true;
      else if (f === "+") plus = true;
      else if (f === " ") space = true;
      else if (f === "#") alt = true;
      else zero = true;
      j++;
    }
    let width = 0;
    if (fmt[j] === "*") {
      const w = toNumber(args[ai++] ?? { k: "int", v: 0 });
      if (w < 0) {
        left = true;
        width = -w;
      } else width = w;
      j++;
    } else {
      while (j < fmt.length && fmt[j]! >= "0" && fmt[j]! <= "9") width = width * 10 + Number(fmt[j++]);
    }
    let prec = -1;
    if (fmt[j] === ".") {
      j++;
      prec = 0;
      if (fmt[j] === "*") {
        prec = Math.max(0, toNumber(args[ai++] ?? { k: "int", v: 0 }));
        j++;
      } else {
        while (j < fmt.length && fmt[j]! >= "0" && fmt[j]! <= "9") prec = prec * 10 + Number(fmt[j++]);
      }
    }
    let length = "";
    while (j < fmt.length && "hlLqjzt".includes(fmt[j]!)) length += fmt[j++];
    const conv = fmt[j];
    i = j;
    if (conv === undefined) {
      out += "%";
      break;
    }
    const signOf = (neg: boolean) => (neg ? "-" : plus ? "+" : space ? " " : "");

    switch (conv) {
      case "d":
      case "i": {
        const a = nextArg(conv);
        if (a?.k === "float") ctx.warn(`printf : « %${conv} » reçoit un nombre réel (double) : comportement indéfini, utilisez %f`);
        if (a?.k === "ptr") ctx.warn(`printf : « %${conv} » reçoit un pointeur`);
        let n = Math.trunc(a ? toNumber(a) : 0);
        if (length === "hh") n = (n << 24) >> 24;
        else if (length === "h") n = (n << 16) >> 16;
        else if (!length.includes("l") && length !== "z" && length !== "j" && length !== "t") n = n | 0;
        const neg = n < 0;
        let digits = Math.abs(n).toString();
        if (prec >= 0) digits = prec === 0 && n === 0 ? "" : digits.padStart(prec, "0");
        const sign = signOf(neg);
        out += pad(sign + digits, width, left, zero && prec < 0, sign.length);
        break;
      }
      case "u":
      case "x":
      case "X":
      case "o": {
        const a = nextArg(conv);
        let n = Math.trunc(a ? toNumber(a) : 0);
        if (length === "hh") n &= 0xff;
        else if (length === "h") n &= 0xffff;
        else if (!length.includes("l") && length !== "z" && length !== "j") n = n >>> 0;
        else if (n < 0) n = n + 2 ** 64;
        const radix = conv === "u" ? 10 : conv === "o" ? 8 : 16;
        let digits = n.toString(radix);
        if (conv === "X") digits = digits.toUpperCase();
        if (prec >= 0) digits = prec === 0 && n === 0 ? "" : digits.padStart(prec, "0");
        let prefix = "";
        if (alt && n !== 0 && conv === "x") prefix = "0x";
        if (alt && n !== 0 && conv === "X") prefix = "0X";
        if (alt && conv === "o" && !digits.startsWith("0")) digits = "0" + digits;
        out += pad(prefix + digits, width, left, zero && prec < 0, prefix.length);
        break;
      }
      case "c": {
        const a = nextArg(conv);
        out += pad(String.fromCharCode(Math.trunc(a ? toNumber(a) : 0) & 0xff), width, left, false);
        break;
      }
      case "s": {
        const a = nextArg(conv);
        let s: string;
        if (!a) s = "";
        else if (a.k === "ptr" && a.b) s = blockString(a.b, a.o);
        else if (a.k === "ptr") s = "(null)";
        else {
          ctx.warn("printf : « %s » attend une chaîne (char *) mais reçoit un nombre : erreur de segmentation probable en vrai");
          s = String(toNumber(a));
        }
        if (prec >= 0) s = s.slice(0, prec);
        out += pad(s, width, left, false);
        break;
      }
      case "f":
      case "F":
      case "e":
      case "E":
      case "g":
      case "G":
      case "a":
      case "A": {
        const a = nextArg(conv);
        if (a?.k === "int") ctx.warn(`printf : « %${conv} » reçoit un entier : comportement indéfini en C (convertissez en double)`);
        const n = a ? toNumber(a) : 0;
        const p = prec < 0 ? 6 : prec;
        const neg = n < 0 || Object.is(n, -0);
        const abs = Math.abs(n);
        let body: string;
        if (!Number.isFinite(abs)) body = Number.isNaN(abs) ? "nan" : "inf";
        else if (conv === "f" || conv === "F") body = abs.toFixed(p);
        else if (conv === "e" || conv === "E") body = expForm(abs, p, conv === "E");
        else if (conv === "g" || conv === "G") body = gForm(abs, p, alt, conv === "G");
        else body = abs.toString(16);
        if (alt && p === 0 && (conv === "f" || conv === "F") && !body.includes(".")) body += ".";
        if (conv === "F" || conv === "E" || conv === "G") body = body.toUpperCase();
        const sign = signOf(neg);
        out += pad(sign + body, width, left, zero && Number.isFinite(abs), sign.length);
        break;
      }
      case "p": {
        const a = nextArg(conv);
        const s = !a || (a.k === "ptr" && !a.b && a.o === 0) ? "(nil)" : "0x" + (a.k === "ptr" ? fakeAddress(a.b, a.o) : toNumber(a)).toString(16);
        out += pad(s, width, left, false);
        break;
      }
      case "n":
        ai++;
        break;
      default:
        out += "%" + conv;
        break;
    }
  }
  if (ai < args.length) {
    ctx.warn(`printf : ${args.length - ai} argument(s) en trop par rapport au format`);
  }
  return out;
}

export type ScanValue = { conv: string; value: number | string };

/**
 * Parses `input` (from position `pos`) with a scanf format.
 * Returns the converted values, the count of successful conversions
 * (-1 on immediate end of input) and the new position.
 */
export function scanInput(fmt: string, input: string, pos: number): { values: ScanValue[]; count: number; pos: number } {
  const values: ScanValue[] = [];
  let p = pos;
  const isSpace = (ch: string | undefined) => ch !== undefined && /\s/.test(ch);
  const skipSpaces = () => {
    while (p < input.length && isSpace(input[p])) p++;
  };

  for (let i = 0; i < fmt.length; i++) {
    const c = fmt[i]!;
    if (isSpace(c)) {
      skipSpaces();
      continue;
    }
    if (c !== "%") {
      if (input[p] === c) {
        p++;
        continue;
      }
      break;
    }
    let j = i + 1;
    let suppress = false;
    if (fmt[j] === "*") {
      suppress = true;
      j++;
    }
    let width = 0;
    while (fmt[j]! >= "0" && fmt[j]! <= "9") width = width * 10 + Number(fmt[j++]);
    while ("hlLqjzt".includes(fmt[j] ?? "x")) j++;
    const conv = fmt[j] ?? "";
    i = j;
    if (conv === "%") {
      skipSpaces();
      if (input[p] === "%") {
        p++;
        continue;
      }
      break;
    }
    if (conv !== "c") skipSpaces();
    if (p >= input.length) {
      return { values, count: values.length === 0 ? -1 : values.length, pos: p };
    }
    const max = width > 0 ? width : Infinity;
    let token = "";
    if (conv === "d" || conv === "i" || conv === "u" || conv === "x" || conv === "o") {
      const re = conv === "x" ? /[0-9a-fA-Fx+-]/ : /[0-9+-]/;
      while (p < input.length && token.length < max && re.test(input[p]!)) {
        if ((input[p] === "+" || input[p] === "-") && token.length > 0) break;
        token += input[p++];
      }
      const n = conv === "x" ? parseInt(token, 16) : conv === "o" ? parseInt(token, 8) : parseInt(token, 10);
      if (Number.isNaN(n)) break;
      if (!suppress) values.push({ conv, value: n });
    } else if (conv === "f" || conv === "e" || conv === "g" || conv === "lf") {
      while (p < input.length && token.length < max && /[0-9eE.+-]/.test(input[p]!)) token += input[p++];
      const n = parseFloat(token);
      if (Number.isNaN(n)) break;
      if (!suppress) values.push({ conv: "f", value: n });
    } else if (conv === "s") {
      while (p < input.length && token.length < max && !isSpace(input[p])) token += input[p++];
      if (!suppress) values.push({ conv, value: token });
    } else if (conv === "c") {
      const n = width > 0 ? width : 1;
      token = input.slice(p, p + n);
      p += token.length;
      if (!suppress) values.push({ conv, value: token });
    } else {
      break;
    }
  }
  return { values, count: values.length, pos: p };
}
