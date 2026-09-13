import { createContext, useCallback, useContext, useMemo, useState, type PropsWithChildren } from "react";
import { AnimatePresence, motion as motionElement, useReducedMotion } from "framer-motion";
import { motion, motionTransition } from "@/shared/motion";

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
  const reducedMotion = useReducedMotion();

  return <FeedbackContext.Provider value={value}>{children}<div className="toast-region" aria-live="polite" aria-atomic="true"><AnimatePresence initial={false}>{messages.map((item) => <motionElement.div className={`toast ${item.tone}`} role={item.tone === "error" ? "alert" : "status"} key={item.id} initial={reducedMotion ? false : { opacity: 0, y: motion.distance }} animate={{ opacity: 1, y: 0 }} exit={reducedMotion ? undefined : { opacity: 0, y: -motion.distance }} transition={motionTransition(motion.fast)}>{item.message}</motionElement.div>)}</AnimatePresence></div></FeedbackContext.Provider>;
}

export function useFeedback() {
  const value = useContext(FeedbackContext);
  if (!value) throw new Error("useFeedback deve ser usado dentro de FeedbackProvider.");
  return value;
}