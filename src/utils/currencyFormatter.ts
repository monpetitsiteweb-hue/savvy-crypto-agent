/**
 * Formats a number as a Euro currency string
 * Format: €123 456 789,00 (French/EU style with spaces as thousands separator)
 */
export const formatEuro = (amount: number | null | undefined): string => {
  console.log('formatEuro called with:', amount, 'type:', typeof amount);
  
  if (amount === null || amount === undefined) {
    console.log('formatEuro returning "-" for null/undefined');
    return "-";
  }
  if (amount === 0) {
    console.log('formatEuro returning "€0,00" for zero');
    return "€0,00";
  }
  if (isNaN(amount) || !isFinite(amount)) {
    console.log('formatEuro returning "-" for NaN/infinite');
    return "-";
  }
  
  try {
    const result = new Intl.NumberFormat('fr-FR', {
      style: 'currency',
      currency: 'EUR',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(amount);
    console.log('formatEuro result:', result);
    return result;
  } catch (error) {
    console.error('formatEuro error:', error, 'amount:', amount);
    return `€${amount.toFixed(2)}`;
  }
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