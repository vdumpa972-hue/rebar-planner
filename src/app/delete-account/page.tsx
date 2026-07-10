import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Account Deletion | Rebar Planner",
  description: "Request deletion of a Rebar Planner account and associated saved project data.",
  alternates: { canonical: "https://rebar-planner.vercel.app/delete-account" },
  openGraph: {
    title: "Account Deletion | Rebar Planner",
    description: "Request deletion of a Rebar Planner account and associated saved project data.",
    url: "https://rebar-planner.vercel.app/delete-account",
    type: "website",
  },
};

export default function DeleteAccountPage() {
  return (
    <main style={{ maxWidth: 900, margin: "40px auto", padding: 20, fontFamily: "Arial, sans-serif" }}>
      <h1>Rebar Planner Account Deletion</h1>

      <p>
        Rebar Planner users may request deletion of their account and associated saved project data.
      </p>

      <h2>How to request account deletion</h2>

      <p>
        To request deletion of your account, email us at:
      </p>

      <p>
        <strong>vdumpa972@gmail.com</strong>
      </p>

      <p>
        Please include the email address used for your Rebar Planner account.
      </p>

      <h2>What data will be deleted</h2>

      <ul>
        <li>Your user account</li>
        <li>Your saved Rebar Planner project data</li>
        <li>Associated account information stored in Firebase/Firestore</li>
      </ul>

      <h2>Processing time</h2>

      <p>
        We will process account deletion requests within 30 days.
      </p>
    </main>
  );
}
