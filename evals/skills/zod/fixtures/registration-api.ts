import { z } from "zod";

export const registerSchema = z.object({
  email: z.string(),
  password: z.string().min(8),
  age: z.number().optional(),
  metadata: z.any(),
});

export function handleRegister(rawBody: unknown) {
  const data = registerSchema.parse(rawBody);
  return createUser(data);
}

function createUser(data: z.infer<typeof registerSchema>) {
  return { id: crypto.randomUUID(), ...data };
}
