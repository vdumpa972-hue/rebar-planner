"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { auth, db } from "@/lib/firebase";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  setDoc,
  where,
} from "firebase/firestore";
import {
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
} from "firebase/auth";

const OWNER_EMAIL = "vdumpa972@gmail.com";

function normalizeLogin(value: string) {
  return value.trim().toLowerCase();
}

function looksLikeEmail(value: string) {
  return value.includes("@");
}

function effectiveRole(email: string, dbRole: string) {
  return email.toLowerCase() === OWNER_EMAIL ? "owner" : (dbRole || "user").toLowerCase();
}

export default function AuthPage() {
  const router = useRouter();
  const [loginId, setLoginId] = useState("");
  const [password, setPassword] = useState("");
  const [loginHistory, setLoginHistory] = useState<string[]>([]);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("rpLoginHistory") || localStorage.getItem("rpEmailHistory") || "[]");
      if (Array.isArray(saved)) setLoginHistory(saved.filter((x): x is string => typeof x === "string"));
    } catch {
      setLoginHistory([]);
    }
  }, []);

  function rememberLogin(value: string) {
    const clean = normalizeLogin(value);
    if (!clean) return;
    const next = [clean, ...loginHistory.filter((item) => item !== clean)].slice(0, 10);
    setLoginHistory(next);
    try { localStorage.setItem("rpLoginHistory", JSON.stringify(next)); } catch {}
  }

  async function resolveEmail(value: string) {
    const clean = normalizeLogin(value);
    if (!clean) throw new Error("Enter email or username.");
    if (looksLikeEmail(clean)) return clean;

    const usernameSnap = await getDocs(query(collection(db, "users"), where("username", "==", clean), limit(1)));
    if (!usernameSnap.empty) {
      const email = String(usernameSnap.docs[0].data().email || "").trim().toLowerCase();
      if (email) return email;
    }

    throw new Error(`No user found for username "${clean}".`);
  }

  async function afterLogin(uid: string, userEmail: string, originalLogin: string) {
    const ref = doc(db, "users", uid);
    const snap = await getDoc(ref);
    let dbRole = "user";

    if (!snap.exists()) {
      dbRole = userEmail.toLowerCase() === OWNER_EMAIL ? "owner" : "user";
      const trialEndsAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
      await setDoc(ref, {
        email: userEmail,
        username: userEmail.split("@")[0],
        role: dbRole,
        status: "active",
        planStatus: dbRole === "owner" ? "owner" : "trialing",
        planName: dbRole === "owner" ? "owner" : "trial",
        trialStartedAt: new Date().toISOString(),
        trialEndsAt,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }, { merge: true });
    } else {
      dbRole = String(snap.data()?.role || "user").toLowerCase();
      if (userEmail.toLowerCase() === OWNER_EMAIL && dbRole !== "owner") {
        await setDoc(ref, { role: "owner", updatedAt: serverTimestamp() }, { merge: true });
      }
    }

    const role = effectiveRole(userEmail, dbRole);
    rememberLogin(originalLogin);
    if (role === "owner" || role === "admin") router.push("/admin");
    else router.push("/");
  }

  async function login() {
    setLoading(true); setNotice(""); setError("");
    try {
      const email = await resolveEmail(loginId);
      const cred = await signInWithEmailAndPassword(auth, email, password);
      await afterLogin(cred.user.uid, cred.user.email || email, loginId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Login failed");
    } finally { setLoading(false); }
  }

  function submitLogin(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!loading) login();
  }

  async function reset() {
    setError(""); setNotice("");
    if (!loginId.trim()) { setError("Enter your email or username first."); return; }
    try {
      const email = await resolveEmail(loginId);
      await sendPasswordResetEmail(auth, email);
      setNotice("Password setup/reset email sent.");
    }
    catch (e) { setError(e instanceof Error ? e.message : "Could not send reset email"); }
  }

  return <main className="page">
    <form className="authBox panel" onSubmit={submitLogin}>
      <div className="brand">Login</div>
      <p className="muted">Users can sign in with email or username. Browser history suggestions are enabled.</p>
      {notice && <p className="notice">{notice}</p>}
      {error && <p className="error">{error}</p>}
      <div className="field"><label>Email or username</label><input id="username" name="username" type="text" value={loginId} onChange={e=>setLoginId(e.target.value)} autoComplete="username email" list="recent-logins" />
        <datalist id="recent-logins">{loginHistory.map(e => <option key={e} value={e} />)}</datalist></div>
      <div className="field"><label>Password</label><input id="password" name="password" value={password} onChange={e=>setPassword(e.target.value)} type="password" autoComplete="current-password" /></div>
      <div className="splitButtons">
        <button disabled={loading} type="submit">Login</button>
        <button disabled={loading} type="button" className="secondary" onClick={reset}>Forgot / Set password</button>
      </div>
    </form>
  </main>;
}
