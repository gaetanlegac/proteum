/**
 * Helper to wait x seconds with promises
 * Usage: await seconds(10); // Wait 10 seconds
 * @param seconds The number of seconds to wait
 * @returns A void promise
 */
export const seconds = (seconds: number) => new Promise((resolve) => setTimeout(resolve, seconds * 1000));