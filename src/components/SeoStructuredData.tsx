export default function SeoStructuredData() {
  const data = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebSite",
      "@id": "https://rebar-planner.vercel.app/#website",
      "url": "https://rebar-planner.vercel.app",
      "name": "Rebar Planner",
      "description": "Plan foundation rebar, calculate bar quantities, create cut and bend schedules, reduce stock waste, and generate shop-ready material lists from project dimensions.",
      "inLanguage": "en-US"
    },
    {
      "@type": "Organization",
      "@id": "https://rebar-planner.vercel.app/#organization",
      "name": "Rebar Planner",
      "url": "https://rebar-planner.vercel.app"
    },
    {
      "@type": "SoftwareApplication",
      "@id": "https://rebar-planner.vercel.app/#software",
      "name": "Rebar Planner",
      "url": "https://rebar-planner.vercel.app",
      "applicationCategory": "BusinessApplication",
      "operatingSystem": "Web, iOS, Android",
      "description": "Plan foundation rebar, calculate bar quantities, create cut and bend schedules, reduce stock waste, and generate shop-ready material lists from project dimensions.",
      "featureList": [
        "Foundation rebar calculations",
        "Cut and bend schedules",
        "Stock length optimization",
        "Material takeoffs",
        "Pier cage planning",
        "Project library"
      ],
      "audience": {
        "@type": "Audience",
        "audienceType": "Concrete contractors, rebar fabricators, builders, and estimators"
      },
      "publisher": {
        "@id": "https://rebar-planner.vercel.app/#organization"
      },
      "offers": {
        "@type": "Offer",
        "price": "0",
        "priceCurrency": "USD",
        "description": "Free trial, guest demo, or free access options may be available; see the current website for plan details."
      }
    },
    {
      "@type": "FAQPage",
      "@id": "https://rebar-planner.vercel.app/#faq",
      "mainEntity": [
        {
          "@type": "Question",
          "name": "What does Rebar Planner calculate?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "It organizes foundation dimensions, laps, bends, spacing, pier cages, and stock lengths into rebar schedules and material takeoffs."
          }
        },
        {
          "@type": "Question",
          "name": "Who is Rebar Planner designed for?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "Concrete contractors, builders, estimators, and rebar professionals who prepare reinforcement plans and material lists."
          }
        },
        {
          "@type": "Question",
          "name": "Can Rebar Planner be tested before purchase?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "A guest demo and trial options are available from the public start page."
          }
        }
      ]
    }
  ]
};

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  );
}
