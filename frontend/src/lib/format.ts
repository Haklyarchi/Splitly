import { ApiError } from "@/lib/api";
import type { Currency } from "@/lib/types";

export const CURRENCIES: { code: Currency; label: string }[] = [
  { code: "USD", label: "USD — US Dollar ($)" },
  { code: "EUR", label: "EUR — Euro (€)" },
  { code: "GBP", label: "GBP — British Pound (£)" },
  { code: "INR", label: "INR — Indian Rupee (₹)" },
  { code: "NZD", label: "NZD — NZ Dollar ($)" },
  { code: "AUD", label: "AUD — Australian Dollar ($)" },
  { code: "CAD", label: "CAD — Canadian Dollar ($)" },
  { code: "SGD", label: "SGD — Singapore Dollar ($)" },
  { code: "JPY", label: "JPY — Japanese Yen (¥)" },
];

export function money(amount: number, currency: Currency): string {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
}

export function errorMessage(err: unknown, fallback = "Something went wrong"): string {
  if (err instanceof ApiError) {
    const body = err.body as { detail?: unknown } | null;
    if (typeof body?.detail === "string") return body.detail;
    if (Array.isArray(body?.detail)) {
      const first = body.detail[0] as { msg?: string } | undefined;
      if (first?.msg) return first.msg;
    }
  }
  return fallback;
}

export function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}
