import type { Transition } from "framer-motion";

/**
 * Motion language shared by the application. These values intentionally stay
 * short so feedback feels responsive and never competes with financial data.
 */
export const motion = {
  fast: 0.14,
  normal: 0.22,
  slow: 0.32,
  easing: [0.22, 1, 0.36, 1] as const,
  distance: 6,
} as const;

export const motionTransition = (duration: number = motion.normal, delay = 0): Transition => ({
  duration,
  delay,
  ease: motion.easing,
});

export const enterFromBelow = (reduced: boolean, delay = 0) =>
  reduced
    ? { initial: false as const, animate: { opacity: 1, y: 0 }, transition: { duration: 0 } }
    : {
        initial: { opacity: 0, y: motion.distance },
        animate: { opacity: 1, y: 0 },
        transition: motionTransition(motion.normal, delay),
      };