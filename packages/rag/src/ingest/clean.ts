export function cleanContent(input: string): string {
  return input
    // eslint-disable-next-line no-control-regex -- strip null bytes and other control characters from extracted text
    .replace(/\u0000/g, "")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0001-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}
