import { z } from "zod";

export const usernameSchema = z
  .string()
  .trim()
  .min(3, "Username must be at least 3 characters.")
  .max(20, "Username must be at most 20 characters.")
  .regex(/^[A-Za-z0-9_]+$/, "Use only letters, numbers, and underscores.");

export const passwordSchema = z.string().min(8, "Password must be at least 8 characters.");

export function normalizeUsername(username: string) {
  return username.trim().toLowerCase();
}

export function usernameToInternalEmail(username: string) {
  // Supabase hosted Auth rejects reserved test domains such as `.invalid`.
  // This address is only an internal credential identifier; the application
  // never displays it or sends mail because email confirmation is disabled.
  return `${normalizeUsername(username)}@lo-l-fantasy.vercel.app`;
}
