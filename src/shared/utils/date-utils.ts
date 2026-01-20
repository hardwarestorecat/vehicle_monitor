/**
 * Get current date in Chicago timezone formatted as YYYY-MM-DD
 */
export function getChicagoDateString(): string {
  const now = new Date();

  // Convert to Chicago timezone (America/Chicago)
  const chicagoDate = new Date(now.toLocaleString('en-US', { timeZone: 'America/Chicago' }));

  const year = chicagoDate.getFullYear();
  const month = String(chicagoDate.getMonth() + 1).padStart(2, '0');
  const day = String(chicagoDate.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
}

/**
 * Build S3 key with date-based folder structure
 * Example: vehicle_monitoring/captured/confirmed/2026-01-19/image.jpg
 */
export function buildDateBasedS3Key(
  prefix: string,
  filename: string,
  dateString?: string
): string {
  const date = dateString || getChicagoDateString();

  // Remove trailing slash from prefix if present
  const cleanPrefix = prefix.endsWith('/') ? prefix.slice(0, -1) : prefix;

  return `${cleanPrefix}/${date}/${filename}`;
}

/**
 * Extract filename from S3 key
 */
export function extractFilename(s3Key: string): string {
  const parts = s3Key.split('/');
  return parts[parts.length - 1];
}
