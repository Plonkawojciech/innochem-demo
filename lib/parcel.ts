import { z } from "zod";
export const parcelSchema = z.object({
  lengthCm: z.number().int().min(1).max(300),
  widthCm: z.number().int().min(1).max(300),
  heightCm: z.number().int().min(1).max(300),
  weightKg: z.number().min(0.1).max(100).multipleOf(0.1),
});
export type Parcel = z.infer<typeof parcelSchema>;
export const parcelFields = [
  ["lengthCm", "Długość (cm)"],
  ["widthCm", "Szerokość (cm)"],
  ["heightCm", "Wysokość (cm)"],
  ["weightKg", "Waga (kg)"],
] as const;
