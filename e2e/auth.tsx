import type { PropsWithChildren } from "react";
export const AuthProvider = ({ children }: PropsWithChildren) => children;
export const useAuth = () => ({ status: "authenticated", user: { id: "fixture-user" }, signOut: async () => {} });
