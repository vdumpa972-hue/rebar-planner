"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { auth, db, getSecondaryAuth } from "@/lib/firebase";
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signOut,
  updateProfile,
} from "firebase/auth";
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import { appRoleOptions } from "@/lib/sharedRebarParameters";

const OWNER_EMAIL = "vdumpa972@gmail.com";

type UserRow = {
  id: string;
  email?: string;
  username?: string;
  role?: string;
  status?: string;
  displayName?: string;
  planStatus?: string;
  planName?: string;
  trialEndsAt?: string;
};

type WorkspaceRow = {
  id: string;
  projectName?: string;
  planFileName?: string;
  ownerUid?: string;
  ownerEmail?: string;
  updatedAt?: { toDate?: () => Date };
  createdAt?: { toDate?: () => Date };
};

function makeUsername(value: string) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/@.*$/, "")
    .replace(/[^a-z0-9._-]+/g, "")
    .slice(0, 40);
}

function dateText(value: unknown) {
  const ts = value as { toDate?: () => Date } | undefined;
  return ts?.toDate ? ts.toDate().toLocaleString() : "";
}

export default function PlannerAdminPage() {
  const router = useRouter();
  const [currentEmail, setCurrentEmail] = useState("");
  const [currentRole, setCurrentRole] = useState("");
  const [authorized, setAuthorized] = useState(false);
  const [checking, setChecking] = useState(true);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [workspaces, setWorkspaces] = useState<WorkspaceRow[]>([]);
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("FFLL972");
  const [role, setRole] = useState("user");
  const [sendSetupEmail, setSendSetupEmail] = useState(true);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const isOwner = currentEmail.toLowerCase() === OWNER_EMAIL || currentRole === "owner";
  const allowedRoleOptions = isOwner ? appRoleOptions : ["user"];

  async function loadUsers() {
    const snap = await getDocs(query(collection(db, "users"), orderBy("email")));
    setUsers(snap.docs.map((d) => ({ id: d.id, ...d.data() } as UserRow)));
  }

  async function loadWorkspaces() {
    const snap = await getDocs(query(collection(db, "plannerWorkspaces"), orderBy("updatedAt", "desc")));
    setWorkspaces(snap.docs.map((d) => ({ id: d.id, ...d.data() } as WorkspaceRow)));
  }

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      setChecking(true);
      setError("");
      if (!user) {
        setAuthorized(false);
        setChecking(false);
        router.push("/auth");
        return;
      }
      const emailValue = user.email || "";
      setCurrentEmail(emailValue);
      const userRef = doc(db, "users", user.uid);
      const snap = await getDoc(userRef);
      let userRole = String(snap.data()?.role || "user").toLowerCase();
      if (emailValue.toLowerCase() === OWNER_EMAIL) {
        userRole = "owner";
        await setDoc(userRef, { email: emailValue, username: makeUsername(emailValue), role: "owner", status: "active", updatedAt: serverTimestamp() }, { merge: true });
      }
      setCurrentRole(userRole);
      if (userRole !== "owner" && userRole !== "admin") {
        setAuthorized(false);
        setChecking(false);
        setError("Only owner or admin users can open this page.");
        return;
      }
      setAuthorized(true);
      setChecking(false);
      await Promise.all([loadUsers(), loadWorkspaces()]);
    });
    return () => unsub();
  }, [router]);

  async function createUser() {
    setNotice("");
    setError("");
    setBusy(true);
    try {
      const cleanEmail = email.trim().toLowerCase();
      const cleanUsername = makeUsername(username || cleanEmail);
      const cleanDisplayName = displayName.trim() || cleanUsername || cleanEmail;
      const cleanRole = role === "owner" && !isOwner ? "user" : role;
      if (!cleanEmail) throw new Error("Enter email.");
      if (!password || password.length < 6) throw new Error("Temporary password must be at least 6 characters.");

      const secondaryAuth = getSecondaryAuth();
      const cred = await createUserWithEmailAndPassword(secondaryAuth, cleanEmail, password);
      await updateProfile(cred.user, { displayName: cleanDisplayName }).catch(() => {});
      await signOut(secondaryAuth).catch(() => {});

      const trialEndsAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
      await setDoc(doc(db, "users", cred.user.uid), {
        email: cleanEmail,
        username: cleanUsername,
        displayName: cleanDisplayName,
        role: cleanRole,
        status: "active",
        planStatus: cleanRole === "owner" ? "owner" : "trialing",
        planName: cleanRole === "owner" ? "owner" : "trial",
        trialStartedAt: new Date().toISOString(),
        trialEndsAt,
        mustChangePassword: true,
        app: "rebar-planner",
        createdByEmail: currentEmail,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }, { merge: true });

      await addDoc(collection(db, "auditLog"), {
        action: "create_planner_user",
        targetEmail: cleanEmail,
        username: cleanUsername,
        role: cleanRole,
        createdByEmail: currentEmail,
        createdAt: serverTimestamp(),
      });

      if (sendSetupEmail) await sendPasswordResetEmail(auth, cleanEmail).catch(() => {});
      setNotice(`Created ${cleanRole}: ${cleanEmail}`);
      setEmail("");
      setUsername("");
      setDisplayName("");
      setPassword("FFLL972");
      setRole("user");
      await loadUsers();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create user");
    } finally {
      setBusy(false);
    }
  }

  async function handleSignOut() {
    setNotice("Signing out...");
    setError("");
    try {
      await signOut(auth);
      router.replace("/auth");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sign out failed");
    }
  }

  async function sendSetup(userEmail: string) {
    setNotice("");
    setError("");
    try {
      await sendPasswordResetEmail(auth, userEmail);
      setNotice(`Password setup/reset email sent to ${userEmail}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not send setup email");
    }
  }

  if (checking) {
    return <main className="page"><section className="panel">Checking admin access...</section></main>;
  }

  if (!authorized) {
    return <main className="page"><section className="panel"><p className="error">{error || "Not authorized."}</p><Link className="tab" href="/">Back to planner</Link></section></main>;
  }

  return (
    <main className="page">
      <div className="topbar">
        <div>
          <div className="brand">Rebar Planner Admin</div>
          <div className="muted">Logged in: {currentEmail} <span className="pill">{isOwner ? "owner" : "admin"}</span></div>
        </div>
        <div className="tabs">
          <Link className="tab" href="/">Planner</Link>
          <Link className="tab activeTab" href="/admin">Admin</Link>
          <button className="secondary" onClick={handleSignOut}>Sign out</button>
        </div>
      </div>

      {notice && <p className="notice">{notice}</p>}
      {error && <p className="error">{error}</p>}

      <div className="grid adminGrid">
        <section className="panel">
          <h2>{isOwner ? "Add admin or user" : "Add user"}</h2>
          <p className="muted">Owner can create admins and users. Admins can create users only. Firebase sends setup/reset emails from its no-reply address.</p>
          <div className="field"><label>Name</label><input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Example: John User" autoComplete="name" /></div>
          <div className="field"><label>Email</label><input value={email} onChange={(e) => { setEmail(e.target.value); if (!username.trim()) setUsername(makeUsername(e.target.value)); }} placeholder="user@example.com" autoComplete="email" /></div>
          <div className="field"><label>Username</label><input value={username} onChange={(e) => setUsername(makeUsername(e.target.value))} placeholder="john" autoComplete="username" /></div>
          <div className="field"><label>Temporary password</label><input value={password} onChange={(e) => setPassword(e.target.value)} type="text" /></div>
          <div className="field"><label>Role</label><select value={role} onChange={(e) => setRole(e.target.value)}>{allowedRoleOptions.map((item) => <option key={item} value={item}>{item}</option>)}</select></div>
          <label className="checkRow"><input type="checkbox" checked={sendSetupEmail} onChange={(e) => setSendSetupEmail(e.target.checked)} /> Send password setup email</label>
          <button disabled={busy} onClick={createUser}>{busy ? "Creating..." : "Create user"}</button>
        </section>

        <section className="panel">
          <div className="row between">
            <div>
              <h2>Users</h2>
              <p className="muted">Owner/admin/user accounts shared with the collector database.</p>
            </div>
            <button className="secondary" onClick={loadUsers}>Refresh</button>
          </div>
          <div className="tableWrap">
            <table className="table userTable">
              <thead><tr><th>Email</th><th>Username</th><th>Name</th><th>Role</th><th>Status</th><th>Plan</th><th>Trial ends</th><th>Setup</th></tr></thead>
              <tbody>{users.map((u) => <tr key={u.id}><td>{u.email}</td><td>{u.username}</td><td>{u.displayName}</td><td><span className="pill">{u.role}</span></td><td>{u.status}</td><td><span className="pill">{u.planStatus || "trialing"}</span></td><td>{u.trialEndsAt ? new Date(u.trialEndsAt).toLocaleDateString() : ""}</td><td><button className="smallButton secondary" onClick={() => u.email && sendSetup(u.email)}>Email</button></td></tr>)}</tbody>
            </table>
          </div>
        </section>
      </div>

      <section className="panel recordDetail">
        <div className="row between">
          <div>
            <h2>Saved Planner Workspaces</h2>
            <p className="muted">Workspace records saved by Rebar Planner.</p>
          </div>
          <button className="secondary" onClick={loadWorkspaces}>Refresh</button>
        </div>
        <div className="tableWrap">
          <table className="table recordsTable">
            <thead><tr><th>Project</th><th>Plan file</th><th>Owner</th><th>Updated</th></tr></thead>
            <tbody>{workspaces.map((w) => <tr key={w.id}><td>{w.projectName || w.id}</td><td>{w.planFileName}</td><td>{w.ownerEmail}</td><td>{dateText(w.updatedAt || w.createdAt)}</td></tr>)}</tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
