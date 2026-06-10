import { initializeApp, getApps, getApp, type FirebaseApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

export const firebaseConfig = {
  apiKey: "AIzaSyAE5rjEamWW2BEq76aRQPWvnNc6-2AyQ1M",
  authDomain: "rebar-planner.firebaseapp.com",
  projectId: "rebar-planner",
  storageBucket: "rebar-planner.firebasestorage.app",
  messagingSenderId: "654784634382",
  appId: "1:654784634382:web:46225215b2ab2e2153265f",
};

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);

export function getSecondaryAuth(): Auth {
  const appName = "collector-user-creator";
  const existing = getApps().find((candidate: FirebaseApp) => candidate.name === appName);
  const secondaryApp = existing || initializeApp(firebaseConfig, appName);
  return getAuth(secondaryApp);
}
