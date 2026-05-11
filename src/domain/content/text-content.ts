export const TEXT_CONTENT_MAX_CHARS = 360;

export const countTextContentCharacters = (htmlContent: string): number => {
  // Strip HTML tags to count actual text characters
  const textOnly = htmlContent.replace(/<[^>]*>/g, "");
  return textOnly.length;
};
