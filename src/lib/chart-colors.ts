/**
 * Chart palette.
 *
 * Bronze (#8B7355 / --primary) is reserved for typographic accents and must
 * never fill a chart surface (bar, pie, area, line). Neutral chart series use
 * petrol; semantic decisions keep refined allow/deny/rate-limited hues.
 */

// Neutral series — petrol, with opacity declinations for multi-series charts.
export const PETROL = '#143F45';
export const PETROL_SERIES = [
  '#143F45', // 100%
  'rgba(20, 63, 69, 0.70)', // 70%
  'rgba(20, 63, 69, 0.45)', // 45%
  'rgba(20, 63, 69, 0.25)', // 25%
];

// Semantic decision colors.
export const DECISION_COLORS: Record<string, string> = {
  allow: '#1E6B4F',
  deny: '#9F1239',
  'rate-limited': '#B4831D',
};
