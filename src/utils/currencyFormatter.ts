/**
 * Formats a number as a Euro currency string
 * Format: €123 456 789,00 (French/EU style with spaces as thousands separator)
 */
export const formatEuro = (amount: number): string => {
  if (amount === 0) return "€0,00";
  if (isNaN(amount) || !isFinite(amount)) return "-";
  
  return new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(amount);
};

/**
 * Formats a percentage with one decimal place
 */
export const formatPercentage = (value: number | null | undefined): string => {
  if (value === null || value === undefined || isNaN(value)) return "-";
  return `${value.toFixed(1)}%`;
};

/**
 * Formats a duration in hours
 */
export const formatDuration = (hours: number | null | undefined): string => {
  if (hours === null || hours === undefined || isNaN(hours)) return "-";
  return `${hours.toFixed(1)}h`;
};