export const TEXT_CONTENT_MAX_CHARS = 1000;

export const countTextContentCharacters = (htmlContent: string): number => {
  // Strip HTML tags to count actual text characters
  const textOnly = htmlContent.replace(/<[^>]*>/g, "");
  return textOnly.length;
};
