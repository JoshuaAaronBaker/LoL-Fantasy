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
  return `${normalizeUsername(username)}@users.lolfantasy.invalid`;
}

