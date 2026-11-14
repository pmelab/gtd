export const shellQuote = (value: string): string => `'${value.replace(/'/g, "'\\''")}'`
