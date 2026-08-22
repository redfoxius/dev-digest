import { z } from "zod";

export function searchProducts(query: Record<string, string | undefined>) {
  const querySchema = z
    .object({
      page: z.number().default(1),
      limit: z.number().default(20),
      minPrice: z.number().optional(),
      maxPrice: z.number().optional(),
    })
    .refine((data) => {
      if (data.minPrice !== undefined && data.maxPrice !== undefined) {
        return data.minPrice <= data.maxPrice;
      }
      return true;
    }, "minPrice must be less than or equal to maxPrice");

  const parsed = querySchema.parse(query);
  return runSearch(parsed);
}

function runSearch(params: { page: number; limit: number; minPrice?: number; maxPrice?: number }) {
  return { params, results: [] };
}
