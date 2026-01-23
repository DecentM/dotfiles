/**
 * Result summary utilities.
 */

const RESULT_SUMMARY_MAX_LENGTH = 500 // Longer summaries to preserve context

/**
 * Create a summary from tool output, truncating if necessary.
 */
export const createResultSummary = (
  output: string,
  maxLength = RESULT_SUMMARY_MAX_LENGTH
): string => {
  if (output.length <= maxLength) {
    return output
  }
  return `${output.substring(0, maxLength - 3)}...`
}
