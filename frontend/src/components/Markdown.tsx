import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Default-exported so it can be pulled into its own chunk via `React.lazy`.
 * `react-markdown` + `remark-gfm` are heavy, so keeping them out of the main
 * bundle keeps initial load fast; assistant messages render plain text until
 * this chunk arrives.
 */
export default function Markdown({ children }: { children: string }) {
  return <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>;
}
