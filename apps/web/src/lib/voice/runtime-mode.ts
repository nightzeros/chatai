/**
 * Voice needs a long-lived Node process: live calls hold sideband sockets, timers and
 * a recording spool in memory. Serverless function platforms freeze or recycle the
 * process between requests, so Voice fails closed there.
 */
const SERVERLESS_MARKERS: Array<[envKey: string, platform: string]> = [
  ["VERCEL", "vercel"],
  ["AWS_LAMBDA_FUNCTION_NAME", "aws_lambda"],
  ["NETLIFY", "netlify"],
];

/** The serverless platform this process runs on, or null for a long-lived runtime. */
export function detectServerlessPlatform(
  processEnv: Record<string, string | undefined> = process.env,
): string | null {
  for (const [key, platform] of SERVERLESS_MARKERS) {
    if (processEnv[key]) return platform;
  }
  return null;
}
