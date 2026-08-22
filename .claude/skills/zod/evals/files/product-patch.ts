import { z } from "zod";

const productSchema = z.object({
  name: z.string().min(1),
  price: z.number().positive(),
  category: z.string(),
  description: z.string(),
});

interface ProductUpdateInput {
  name?: string;
  price?: number;
  category?: string;
  description?: string;
}

const productUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  price: z.number().positive().optional(),
  category: z.string().optional(),
  description: z.string().optional(),
});

export function applyProductUpdate(rawJson: string, existing: ProductUpdateInput) {
  const parsedBody = JSON.parse(rawJson);
  const patch = parsedBody as ProductUpdateInput;
  return { ...existing, ...patch };
}

export function validateProductUpdate(input: unknown) {
  return productUpdateSchema.parse(input);
}
