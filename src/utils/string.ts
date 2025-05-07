/**
 * Thoroughly removes all types of whitespace characters from both ends of a string.
 * Handles spaces, tabs, line breaks, and carriage returns.
 */
export const fullTrim = (str: string): string => {
  return str.replace(/^[\s\r\n\t]+|[\s\r\n\t]+$/g, '');
};
