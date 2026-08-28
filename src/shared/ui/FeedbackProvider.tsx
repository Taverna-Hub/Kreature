import { createContext, useCallback, useContext, useMemo, useState, type PropsWithChildren } from "react";

type Feedback = { id: number; message: string; tone: "success" | "error" };
type FeedbackContextValue = { notify: (message: string, tone?: Feedback["tone"]) => void };

const FeedbackContext = createContext<FeedbackContextValue | null>(null);

export function FeedbackProvider({ children }: PropsWithChildren) {
  const [messages, setMessages] = useState<Feedback[]>([]);
  const notify = useCallback((message: string, tone: Feedback["tone"] = "success") => {
    const id = Date.now();
    setMessages((current) => [...current, { id, message, tone }]);
    window.setTimeout(() => setMessages((current) => current.filter((item) => item.id !== id)), 4_000);
  }, []);
  const value = useMemo(() => ({ notify }), [notify]);

  return <FeedbackContext.Provider value={value}>{children}<div className="toast-region" aria-live="polite" aria-atomic="true">{messages.map((item) => <div className={`toast ${item.tone}`} key={item.id}>{item.message}</div>)}</div></FeedbackContext.Provider>;
}

export function useFeedback() {
  const value = useContext(FeedbackContext);
  if (!value) throw new Error("useFeedback deve ser usado dentro de FeedbackProvider.");
  return value;
}
