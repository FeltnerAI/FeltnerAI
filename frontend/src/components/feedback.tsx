/* eslint-disable react-refresh/only-export-components */
import {
  AlertTriangle,
  CheckCircle2,
  Info,
  X,
  XCircle,
} from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Button, Modal } from "./ui";

type ToastTone = "info" | "success" | "error";

interface ToastItem {
  id: number;
  message: string;
  tone: ToastTone;
}

interface ConfirmOptions {
  title: string;
  message?: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
}

interface PromptOptions {
  title: string;
  label: string;
  defaultValue?: string;
  confirmText?: string;
  placeholder?: string;
}

interface FeedbackValue {
  toast: (message: string, tone?: ToastTone) => void;
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  prompt: (options: PromptOptions) => Promise<string | null>;
}

const FeedbackContext = createContext<FeedbackValue | null>(null);

type DialogState =
  | { kind: "confirm"; options: ConfirmOptions; resolve: (ok: boolean) => void }
  | {
      kind: "prompt";
      options: PromptOptions;
      resolve: (value: string | null) => void;
    }
  | null;

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [promptValue, setPromptValue] = useState("");
  const counter = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const toast = useCallback(
    (message: string, tone: ToastTone = "info") => {
      const id = ++counter.current;
      setToasts((current) => [...current, { id, message, tone }]);
      window.setTimeout(() => dismiss(id), 4200);
    },
    [dismiss],
  );

  const confirm = useCallback(
    (options: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        setDialog({ kind: "confirm", options, resolve });
      }),
    [],
  );

  const prompt = useCallback(
    (options: PromptOptions) =>
      new Promise<string | null>((resolve) => {
        setPromptValue(options.defaultValue ?? "");
        setDialog({ kind: "prompt", options, resolve });
      }),
    [],
  );

  const closeDialog = useCallback(
    (result: boolean | string | null) => {
      if (!dialog) return;
      if (dialog.kind === "confirm") dialog.resolve(result as boolean);
      else dialog.resolve(result as string | null);
      setDialog(null);
    },
    [dialog],
  );

  const value = useMemo<FeedbackValue>(
    () => ({ toast, confirm, prompt }),
    [toast, confirm, prompt],
  );

  const toneIcon = {
    info: <Info size={18} className="text-[var(--accent)]" />,
    success: <CheckCircle2 size={18} className="text-emerald-500" />,
    error: <XCircle size={18} className="text-[var(--danger)]" />,
  };

  return (
    <FeedbackContext.Provider value={value}>
      {children}

      {/* Toast stack */}
      <div className="pointer-events-none fixed right-4 bottom-4 z-[60] flex w-[min(92vw,22rem)] flex-col gap-2">
        {toasts.map((item) => (
          <div
            key={item.id}
            role="status"
            className="panel-strong toast-in pointer-events-auto flex items-start gap-3 rounded-xl p-3.5 text-sm"
          >
            <span className="mt-0.5 shrink-0">{toneIcon[item.tone]}</span>
            <span className="min-w-0 flex-1">{item.message}</span>
            <button
              className="shrink-0 opacity-60 transition hover:opacity-100"
              onClick={() => dismiss(item.id)}
              aria-label="Dismiss"
            >
              <X size={15} />
            </button>
          </div>
        ))}
      </div>

      {/* Confirm dialog */}
      <Modal
        open={dialog?.kind === "confirm"}
        onOpenChange={(open) => !open && closeDialog(false)}
        title={dialog?.kind === "confirm" ? dialog.options.title : ""}
      >
        {dialog?.kind === "confirm" && (
          <div className="grid gap-5">
            {dialog.options.danger && (
              <div className="flex items-center gap-2 text-[var(--danger)]">
                <AlertTriangle size={18} />
                <span className="text-sm font-semibold">
                  This action cannot be undone.
                </span>
              </div>
            )}
            {dialog.options.message && (
              <p className="text-[var(--muted)]">{dialog.options.message}</p>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => closeDialog(false)}>
                {dialog.options.cancelText ?? "Cancel"}
              </Button>
              <Button
                variant={dialog.options.danger ? "danger" : "primary"}
                onClick={() => closeDialog(true)}
              >
                {dialog.options.confirmText ?? "Confirm"}
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Prompt dialog */}
      <Modal
        open={dialog?.kind === "prompt"}
        onOpenChange={(open) => !open && closeDialog(null)}
        title={dialog?.kind === "prompt" ? dialog.options.title : ""}
      >
        {dialog?.kind === "prompt" && (
          <form
            className="grid gap-5"
            onSubmit={(event) => {
              event.preventDefault();
              closeDialog(promptValue.trim() || null);
            }}
          >
            <label className="grid gap-1.5 text-sm font-semibold">
              <span>{dialog.options.label}</span>
              <input
                autoFocus
                className="field font-normal"
                value={promptValue}
                placeholder={dialog.options.placeholder}
                onChange={(event) => setPromptValue(event.target.value)}
              />
            </label>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => closeDialog(null)}
              >
                Cancel
              </Button>
              <Button type="submit">
                {dialog.options.confirmText ?? "Save"}
              </Button>
            </div>
          </form>
        )}
      </Modal>
    </FeedbackContext.Provider>
  );
}

export function useFeedback() {
  const value = useContext(FeedbackContext);
  if (!value) throw new Error("Feedback context is unavailable.");
  return value;
}
