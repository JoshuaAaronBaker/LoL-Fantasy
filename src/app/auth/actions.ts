"use server";

import { redirect } from "next/navigation";
import { passwordSchema, usernameSchema, usernameToInternalEmail } from "@/lib/auth/credentials";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export interface AuthFormState {
  errors?: { username?: string[]; password?: string[] };
  message?: string;
}

function returnPath(formData: FormData) {
  const candidate = String(formData.get("returnTo") ?? "/");
  return candidate.startsWith("/") && !candidate.startsWith("//") ? candidate : "/";
}

function parseCredentials(formData: FormData) {
  const username = usernameSchema.safeParse(formData.get("username"));
  const password = passwordSchema.safeParse(formData.get("password"));
  if (!username.success || !password.success) {
    return {
      success: false as const,
      errors: {
        username: username.success ? undefined : username.error.issues.map((issue) => issue.message),
        password: password.success ? undefined : password.error.issues.map((issue) => issue.message),
      },
    };
  }
  return { success: true as const, username: username.data, password: password.data };
}

export async function registerAction(_state: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const parsed = parseCredentials(formData);
  if (!parsed.success) return parsed;
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signUp({
    email: usernameToInternalEmail(parsed.username),
    password: parsed.password,
    options: { data: { username: parsed.username } },
  });
  if (error || !data.user) return { message: "We could not create that account. Try another username." };
  if (!data.session) {
    const signedIn = await supabase.auth.signInWithPassword({
      email: usernameToInternalEmail(parsed.username),
      password: parsed.password,
    });
    if (signedIn.error) return { message: "Account created, but automatic sign-in failed. Please log in." };
  }
  redirect(returnPath(formData));
}

export async function loginAction(_state: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const parsed = parseCredentials(formData);
  if (!parsed.success) return parsed;
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: usernameToInternalEmail(parsed.username),
    password: parsed.password,
  });
  if (error) return { message: "The username or password is incorrect." };
  redirect(returnPath(formData));
}

export async function logoutAction() {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/");
}
