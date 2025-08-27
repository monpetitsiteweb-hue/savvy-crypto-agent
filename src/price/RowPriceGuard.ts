// Guards to prevent row-level price hooks in History components
export function forbidRowPriceHooks(): never {
  throw new Error("Forbidden: row-level price hooks in History. Use shared priceMap.");
}

// Block common price hooks used by History rows
export const useRealTimeMarketData = () => forbidRowPriceHooks();
export const useMarketData = () => forbidRowPriceHooks();
export const usePrice = () => forbidRowPriceHooks();