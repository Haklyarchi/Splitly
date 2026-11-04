import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowRight, Equal, ListOrdered, User as UserIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiPost } from "@/lib/api";
import { beginSession } from "@/lib/session";
import { errorMessage } from "@/lib/format";
import type { User } from "@/lib/types";
import { Brand } from "@/components/AppShell";

export default function AuthPage({ mode }: { mode: "login" | "register" }) {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const rawNext = params.get("next") ?? "";
  const next = rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/groups";
  const isInvite = next.startsWith("/join/");
  const nextQs = next !== "/groups" ? `?next=${encodeURIComponent(next)}` : "";
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const isLogin = mode === "login";

  const mut = useMutation({
    mutationFn: (body: Record<string, string>) =>
      apiPost<User>(isLogin ? "/auth/login" : "/auth/register", body),
    onSuccess: () => {
      beginSession();
      nav(next);
    },
    onError: (e) => toast.error(errorMessage(e, isLogin ? "Login failed" : "Sign up failed")),
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    mut.mutate(isLogin ? { email, password } : { name, email, password });
  };

  return (
    <div className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      <aside className="relative hidden overflow-hidden bg-slate-900 p-12 text-slate-50 lg:flex lg:flex-col lg:justify-between">
        <div className="absolute -right-24 -top-24 h-96 w-96 rounded-full bg-teal-500/20 blur-3xl" />
        <div className="relative [&_span]:text-slate-50 [&_a>span:first-child]:bg-teal-400 [&_a>span:first-child]:text-slate-900">
          <Brand />
        </div>
        <div className="relative max-w-md">
          <p className="mb-4 text-xs font-bold uppercase tracking-[0.18em] text-teal-300">Split it. Settle it.</p>
          <h1 className="text-5xl font-black leading-[1.05] tracking-tight">
            Fewer awkward money chats. More trips.
          </h1>
          <div className="mt-10 space-y-3">
            {[
              { icon: Equal, t: "Equal split", d: "Divide evenly among whoever was there" },
              { icon: ListOrdered, t: "Exact amounts", d: "Type each person's share, we check the sum" },
              { icon: UserIcon, t: "One person owes all", d: "Covered someone? Log it in one tap" },
            ].map(({ icon: Icon, t, d }) => (
              <div key={t} className="flex items-start gap-3 rounded-2xl border border-slate-800 bg-slate-800/40 p-4">
                <Icon className="mt-0.5 h-5 w-5 text-teal-300" />
                <div>
                  <p className="font-semibold">{t}</p>
                  <p className="text-sm text-slate-400">{d}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
        <p className="relative text-sm text-slate-500">Debts simplified to the fewest possible transfers.</p>
      </aside>

      <section className="flex items-center justify-center px-6 py-12">
        <form onSubmit={submit} className="animate-rise-in w-full max-w-sm space-y-6" data-testid="auth-form">
          <div className="lg:hidden"><Brand /></div>
          <div>
            <h2 className="text-3xl font-black tracking-tight">{isLogin ? "Welcome back" : "Create your account"}</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              {isLogin ? "Log in to see who owes what." : "Start splitting bills in under a minute."}
            </p>
            {isInvite && (
              <p className="mt-3 rounded-xl bg-teal-50 px-4 py-3 text-sm font-medium text-teal-900" data-testid="auth-invite-banner">
                You've been invited to a group. {isLogin ? "Log in to join — new here? Create an account below." : "Create an account to join — it takes a few seconds."}
              </p>
            )}
          </div>
          {!isLogin && (
            <div className="space-y-2">
              <Label htmlFor="name">Name</Label>
              <Input id="name" value={name} onChange={(e) => setName(e.target.value)} required data-testid="register-name-input" />
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required data-testid="auth-email-input" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input id="password" type="password" value={password} minLength={isLogin ? undefined : 6} onChange={(e) => setPassword(e.target.value)} required data-testid="auth-password-input" />
          </div>
          <Button type="submit" className="h-11 w-full text-base font-semibold" disabled={mut.isPending} data-testid="login-submit-btn">
            {mut.isPending ? "Please wait…" : isLogin ? "Log in" : "Create account"} <ArrowRight className="h-4 w-4" />
          </Button>
          {isLogin && (
            <button
              type="button"
              onClick={() => { setEmail("demo@splitly.app"); setPassword("demo1234"); }}
              className="w-full rounded-xl border border-dashed border-teal-300 bg-teal-50 px-4 py-3 text-left text-sm text-teal-900 transition-colors duration-150 hover:bg-teal-100"
              data-testid="fill-demo-credentials"
            >
              <span className="font-semibold">Try the demo:</span> <span className="money">demo@splitly.app / demo1234</span>
            </button>
          )}
          <p className="text-sm text-muted-foreground">
            {isLogin ? "New here? " : "Already have an account? "}
            <Link to={(isLogin ? "/register" : "/login") + nextQs} className="font-semibold text-primary hover:underline" data-testid="auth-switch-link">
              {isLogin ? "Create an account" : "Log in"}
            </Link>
          </p>
        </form>
      </section>
    </div>
  );
}
