import { MarkdownTextPrimitive } from "@assistant-ui/react-markdown";
import remarkGfm from "remark-gfm";

// Streaming-aware markdown rendered through assistant-ui. Styling is provided by
// the existing `.prose-message` rules in styles.css so chat and the coding agent
// share one typographic treatment.
export function MarkdownText() {
  return (
    <MarkdownTextPrimitive
      remarkPlugins={[remarkGfm]}
      className="prose-message max-w-none"
    />
  );
}
