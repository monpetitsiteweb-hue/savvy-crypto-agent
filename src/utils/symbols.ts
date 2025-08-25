export type BaseSymbol = string;        // e.g., "BTC"
export type PairSymbol = `${string}-EUR`; // e.g., "BTC-EUR"

export const toBaseSymbol = (input: string): BaseSymbol =>
  input.includes("-") ? input.split("-")[0] : input;

export const toPairSymbol = (base: BaseSymbol): PairSymbol =>
  `${toBaseSymbol(base)}-EUR` as PairSymbol;