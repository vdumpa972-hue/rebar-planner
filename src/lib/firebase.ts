import { initializeApp, getApps, getApp, type FirebaseApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

export const firebaseConfig = {
  apiKey: "AIzaSyCxF1N8xFBF4R9i8v5E25H58ov04snJ7l4",
  authDomain: "rebar-training-collector.firebaseapp.com",
  projectId: "rebar-training-collector",
  storageBucket: "rebar-training-collector.firebasestorage.app",
  messagingSenderId: "509682482486",
  appId: "1:509682482486:web:988be7de46da2206b1c797",
};

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);

export function getSecondaryAuth(): Auth {
  const appName = "collector-user-creator";
  const existing = getApps().find((candidate: FirebaseApp) => candidate.name === appName);
  const secondaryApp = existing || initializeApp(firebaseConfig, appName);
  return getAuth(secondaryApp);
}
