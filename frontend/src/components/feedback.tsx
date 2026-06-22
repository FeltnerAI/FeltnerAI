/* eslint-disable react-refresh/only-export-components */
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { toast as sonnerToast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Toaster } from "@/components/ui/sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type ToastTone = "info" | "success" | "error";

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
  const [dialog, setDialog] = useState<DialogState>(null);
  const [promptValue, setPromptValue] = useState("");

  const toast = useCallback((message: string, tone: ToastTone = "info") => {
    if (tone === "success") sonnerToast.success(message);
    else if (tone === "error") sonnerToast.error(message);
    else sonnerToast(message);
  }, []);

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

  const closeConfirm = useCallback(
    (ok: boolean) => {
      if (dialog?.kind === "confirm") dialog.resolve(ok);
      setDialog(null);
    },
    [dialog],
  );

  const closePrompt = useCallback(
    (result: string | null) => {
      if (dialog?.kind === "prompt") dialog.resolve(result);
      setDialog(null);
    },
    [dialog],
  );

  const value = useMemo<FeedbackValue>(
    () => ({ toast, confirm, prompt }),
    [toast, confirm, prompt],
  );

  return (
    <FeedbackContext.Provider value={value}>
      {children}
      <Toaster />

      <AlertDialog
        open={dialog?.kind === "confirm"}
        onOpenChange={(open) => !open && closeConfirm(false)}
      >
        <AlertDialogContent>
          {dialog?.kind === "confirm" && (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>{dialog.options.title}</AlertDialogTitle>
                <AlertDialogDescription
                  className={dialog.options.message ? "" : "sr-only"}
                >
                  {dialog.options.message ??
                    (dialog.options.danger
                      ? "This action cannot be undone."
                      : "Please confirm.")}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel onClick={() => closeConfirm(false)}>
                  {dialog.options.cancelText ?? "Cancel"}
                </AlertDialogCancel>
                <AlertDialogAction
                  className={
                    dialog.options.danger
                      ? "bg-destructive text-[var(--danger-contrast)] hover:brightness-110"
                      : undefined
                  }
                  onClick={() => closeConfirm(true)}
                >
                  {dialog.options.confirmText ?? "Confirm"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </>
          )}
        </AlertDialogContent>
      </AlertDialog>

      <Dialog
        open={dialog?.kind === "prompt"}
        onOpenChange={(open) => !open && closePrompt(null)}
      >
        <DialogContent>
          {dialog?.kind === "prompt" && (
            <form
              className="grid gap-5"
              onSubmit={(event) => {
                event.preventDefault();
                closePrompt(promptValue.trim() || null);
              }}
            >
              <DialogHeader>
                <DialogTitle>{dialog.options.title}</DialogTitle>
                <DialogDescription className="sr-only">
                  {dialog.options.title}
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-1.5">
                <Label>{dialog.options.label}</Label>
                <Input
                  autoFocus
                  value={promptValue}
                  placeholder={dialog.options.placeholder}
                  onChange={(event) => setPromptValue(event.target.value)}
                />
              </div>
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => closePrompt(null)}
                >
                  Cancel
                </Button>
                <Button type="submit">
                  {dialog.options.confirmText ?? "Save"}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </FeedbackContext.Provider>
  );
}

export function useFeedback() {
  const value = useContext(FeedbackContext);
  if (!value) throw new Error("Feedback context is unavailable.");
  return value;
}
