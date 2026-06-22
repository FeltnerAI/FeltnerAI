import { useEffect, useState } from "react";
import { Toaster as Sonner, type ToasterProps } from "sonner";

// The shadcn Toaster normally reads the theme from next-themes; this app toggles
// a `.dark` class on <html> instead (see contexts.tsx), so we mirror that.
function useDocumentTheme(): "light" | "dark" {
  const [dark, setDark] = useState(() =>
    typeof document !== "undefined"
      ? document.documentElement.classList.contains("dark")
      : false,
  );
  useEffect(() => {
    const root = document.documentElement;
    const observer = new MutationObserver(() =>
      setDark(root.classList.contains("dark")),
    );
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);
  return dark ? "dark" : "light";
}

function Toaster(props: ToasterProps) {
  const theme = useDocumentTheme();
  return (
    <Sonner
      theme={theme}
      className="toaster group"
      position="bottom-right"
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border-strong)",
        } as React.CSSProperties
      }
      {...props}
    />
  );
}

export { Toaster };
