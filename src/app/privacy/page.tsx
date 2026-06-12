export default function PrivacyPage() {
  return (
    <main style={{ maxWidth: 900, margin: "40px auto", padding: 20 }}>
      <h1>Rebar Planner Privacy Policy</h1>

      <p><strong>Effective Date: June 2026</strong></p>

      <p>
        Rebar Planner ("we", "our", or "the app") respects your privacy.
        This Privacy Policy explains what information we collect and how we use it.
      </p>

      <h2>Information We Collect</h2>
      <ul>
        <li>Email address</li>
        <li>User account credentials for authentication</li>
        <li>Project data created by the user including rebar calculations and saved project information</li>
      </ul>

      <h2>How We Use Information</h2>
      <ul>
        <li>Authenticate users and manage accounts</li>
        <li>Save and synchronize projects across devices</li>
        <li>Store project data securely using cloud services</li>
      </ul>

      <h2>Data Storage</h2>
      <p>
        User account and project data are stored using Firebase Authentication
        and Firebase Firestore.
      </p>

      <h2>Data Sharing</h2>
      <p>
        We do not sell or share user data for advertising or marketing purposes.
      </p>

      <h2>Security</h2>
      <p>
        We take reasonable measures to protect stored information.
      </p>

      <h2>Contact</h2>
      <p>vdumpa972@gmail.com</p>
    </main>
  );
}