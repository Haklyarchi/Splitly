// Hand-written mirrors of backend/models/*.py — keep in sync.
export interface User {
  id: string;
  name: string;
  email: string;
}

export type Currency = "NZD" | "AUD" | "USD" | "EUR" | "GBP" | "JPY" | "CAD" | "SGD" | "INR";
export type SplitType = "equal" | "exact" | "full" | "items";

export interface Member {
  id: string;
  name: string;
  user_id: string | null;
}

export interface ExpenseItem {
  name: string;
  price: number;
  member_ids: string[];
}

export interface Group {
  id: string;
  name: string;
  currency: Currency;
  members: Member[];
  owner_id: string;
  user_ids: string[];
  created_at: string;
}

export interface GroupListItem extends Group {
  expense_count: number;
  total_spent: number;
  unsettled_count: number;
}

export interface GroupCreate {
  name: string;
  currency: Currency;
  members: string[];
}

export interface ExpenseCreate {
  description: string;
  amount: number;
  paid_by: string;
  split_type: SplitType;
  participant_ids: string[];
  exact_amounts: Record<string, number>;
  items?: ExpenseItem[];
  date?: string | null;
}

export interface ExpenseEdit {
  at: string;
  by_name: string;
  changes: string[];
}

export interface Expense {
  id: string;
  group_id: string;
  description: string;
  amount: number;
  paid_by: string;
  split_type: SplitType;
  shares: Record<string, number>;
  items: ExpenseItem[];
  date: string;
  created_at: string;
  updated_at: string | null;
  edits: ExpenseEdit[];
  has_receipt: boolean;
  settled: boolean;
}

export interface SettlementCreate {
  from_member: string;
  to_member: string;
  amount: number;
  note?: string | null;
}

export interface ReminderCreate {
  from_member: string;
  to_member: string;
}

export interface ReceiptIn {
  data_url: string;
}

export interface ScannedItem {
  name: string;
  price: number;
}

export interface ReceiptScan {
  items: ScannedItem[];
  amount: number | null;
  description: string | null;
  date: string | null;
  currency: string | null;
}

export interface ReminderOut {
  notified: number;
  amount: number;
}

export interface Settlement {
  id: string;
  group_id: string;
  from_member: string;
  to_member: string;
  amount: number;
  note: string | null;
  has_receipt: boolean;
  recorded_by: string | null;
  recorded_by_name: string | null;
  confirmed_at: string | null;
  confirmed_by_name: string | null;
  can_confirm: boolean;
  created_at: string;
}

export interface MemberBalance {
  member_id: string;
  name: string;
  paid: number;
  share: number;
  net: number;
}

export interface Transfer {
  from_member: string;
  from_name: string;
  to_member: string;
  to_name: string;
  amount: number;
  last_reminded_at: string | null;
}

export interface GroupSummary {
  currency: Currency;
  total_spent: number;
  balances: MemberBalance[];
  transfers: Transfer[];
  settlements: Settlement[];
}

// mirrors backend/models/notifications.py
export interface Notification {
  id: string;
  user_id: string;
  group_id: string;
  group_name: string;
  kind: "expense" | "settlement" | "reminder" | "member";
  actor_name: string;
  message: string;
  read: boolean;
  created_at: string;
}

export interface NotificationList {
  items: Notification[];
  unread_count: number;
}

export interface InviteLink {
  token: string;
}

export interface InviteMember {
  id: string;
  name: string;
  claimed: boolean;
  mine: boolean;
}

export interface InvitePreview {
  group_id: string;
  group_name: string;
  currency: Currency;
  invited_by: string | null;
  members: InviteMember[];
  already_member: boolean;
}

export interface InviteJoin {
  member_id?: string | null;
  new_name?: string | null;
}
