import { type AIMessage, type AuditLogger } from "#/application/ports/ai";
import { detectPromptInjection, sanitizeUserMessage } from "./system-prompt";

export class AIInputValidator {
  constructor(private readonly auditLogger: AuditLogger) {}

  validateAndSanitize(
    messages: AIMessage[],
    userId: string,
  ): { messages: AIMessage[]; injectionDetected: boolean } {
    let injectionDetected = false;

    const sanitizedMessages = messages.map((msg) => {
      if (msg.role === "user") {
        const sanitized = sanitizeUserMessage(msg.content);

        if (detectPromptInjection(msg.content)) {
          injectionDetected = true;

          this.auditLogger.log({
            event: "ai.injection.detected",
            userId,
            metadata: {
              messageLength: msg.content.length,
              truncatedSample: msg.content.slice(0, 100),
            },
          });
        }

        return { ...msg, content: sanitized };
      }
      return msg;
    });

    return { messages: sanitizedMessages, injectionDetected };
  }
}
