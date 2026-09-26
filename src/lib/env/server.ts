import { z } from "zod";

const serverEnvSchema = z.object({
  DATABASE_URL: z.string().url().or(z.string().startsWith("postgresql://")),
  CITO_API_KEY: z.string().min(1).optional(),
});

export function getServerEnv() {
  const result = serverEnvSchema.safeParse({
    DATABASE_URL: process.env.DATABASE_URL,
    CITO_API_KEY: process.env.CITO_API_KEY || undefined,
  });
  if (!result.success) {
    throw new Error(`Invalid server environment: ${z.prettifyError(result.error)}`);
  }
  return result.data;
}
