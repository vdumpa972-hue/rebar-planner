export default function SeoStructuredData() {
  const data = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  "name": "Rebar Planner",
  "url": "https://rebar-planner.vercel.app",
  "applicationCategory": "BusinessApplication",
  "operatingSystem": "Web, iOS, Android",
  "description": "Plan foundation rebar, calculate bar quantities, create cut and bend schedules, reduce stock waste, and generate shop-ready material lists from project dimensions.",
  "audience": {
    "@type": "Audience",
    "audienceType": "Concrete contractors, rebar fabricators, builders, and estimators"
  },
  "offers": {
    "@type": "Offer",
    "price": "0",
    "priceCurrency": "USD",
    "description": "Free trial or free access options may be available; see the current pricing page."
  }
};

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  );
}
