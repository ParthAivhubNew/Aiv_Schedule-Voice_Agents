// Where to get API access and what each connector's vendor charges, read from the vendors' own pages (Nov 2026).
// Vendors change prices, so the panel tells people to check before buying. Where a vendor publishes no price the row says so.
const row = (plan, price, note) => ({ plan, price, note });

export const CONNECTOR_PRICING = {
  ch_registry: {
    apiUrl: "https://developer.company-information.service.gov.uk/get-started",
    pricingUrl: "https://developer.company-information.service.gov.uk/developer-guidelines",
    free: true, asOf: "Nov 2026",
    pricing: [row("Public Data API key", "£0", "Free account and app"), row("Rate limit", "£0", "600 requests per 5 minutes"), row("Streaming API", "£0", "Separate streaming key")],
  },
  fsa_hygiene: {
    apiUrl: "https://www.food.gov.uk/food-hygiene-rating-scheme-api-version-2",
    pricingUrl: "https://ratings.food.gov.uk/open-data",
    free: true, asOf: "Nov 2026",
    pricing: [row("FHRS API v2", "£0", "No registration needed"), row("Open data download", "£0", "Open Government Licence, daily")],
  },
  cqc_care: {
    apiUrl: "https://api-portal.service.cqc.org.uk/",
    pricingUrl: "https://www.cqc.org.uk/about-us/transparency/using-cqc-data",
    free: true, asOf: "Nov 2026",
    pricing: [row("Syndication API", "£0", "Key from developer portal"), row("Licence", "£0", "Open Government Licence 3.0")],
  },
  tps_ctps: {
    apiUrl: "https://corporate.tpsonline.org.uk/",
    pricingUrl: "https://corporate.tpsonline.org.uk/prices",
    free: false, asOf: "Nov 2026",
    pricing: [row("TPS full annual licence", "£2,200 + VAT", "Unlimited file, daily updates"), row("TPS ad-hoc licence", "From £300", "Campaign or region limited"), row("CTPS licence", "From £150", "Corporate register only")],
  },
  os_postcodes: {
    apiUrl: "https://docs.os.uk/os-apis/accessing-os-apis/os-places-api",
    pricingUrl: "https://osdatahub.os.uk/plans",
    free: false, asOf: "Nov 2026",
    pricing: [row("Premium Plan", "£0.0294 per call", "Not in the £1,000 free allowance"), row("Development mode", "£0", "Not for live use"), row("Partner trial", "£0", "60 days or 2,000 calls")],
  },
  experian: {
    apiUrl: "https://developer.experian.com/contact-us",
    pricingUrl: "https://experian.co.uk/business/third-party-data/b2b-business-data",
    free: false, asOf: "Nov 2026",
    pricing: [row("Quote only", "Contact sales", "Priced per contract")],
  },
  market_location: {
    apiUrl: "https://www.marketlocation.com/contact-us/",
    pricingUrl: "https://www.marketlocation.com/business-data/",
    free: false, asOf: "Nov 2026",
    pricing: [row("Quote only", "Contact sales", "Priced per contract")],
  },
  salesforce: {
    apiUrl: "https://developer.salesforce.com/docs/platform/api-rest/guide/intro-oauth-and-connected-apps.html",
    pricingUrl: "https://www.salesforce.com/sales/pricing/",
    free: false, asOf: "Nov 2026",
    pricing: [row("Pro Suite", "$100 user/month", "API add-on $25 more"), row("Core (Enterprise)", "$195 user/month", "API access included"), row("Advanced", "$395 user/month", "Annual contract")],
  },
  hubspot: {
    apiUrl: "https://developers.hubspot.com/docs/apps/legacy-apps/private-apps/overview",
    pricingUrl: "https://www.hubspot.com/pricing/sales",
    free: true, asOf: "Nov 2026",
    pricing: [row("Free", "$0", "Up to 2 users"), row("Sales Hub Starter", "$20 seat/month", "100 requests per 10 seconds"), row("Sales Hub Professional", "$100 seat/month", "190 requests per 10 seconds")],
  },
  dynamics365: {
    apiUrl: "https://learn.microsoft.com/en-us/power-apps/developer/data-platform/authenticate-oauth",
    pricingUrl: "https://www.microsoft.com/en-us/dynamics-365/products/sales/pricing",
    free: false, asOf: "Nov 2026",
    pricing: [row("Sales Professional", "$65 user/month", "Paid yearly"), row("Sales Enterprise", "$105 user/month", "Paid yearly"), row("Sales Premium", "$150 user/month", "Paid yearly")],
  },
  zoho_crm: {
    apiUrl: "https://www.zoho.com/crm/developer/docs/api/v8/register-client.html",
    pricingUrl: "https://www.zoho.com/crm/zohocrm-pricing.html",
    free: true, asOf: "Nov 2026",
    pricing: [row("Free", "$0", "Up to 3 users"), row("Standard", "$14 user/month", "Billed annually"), row("Professional", "$23 user/month", "Billed annually"), row("Enterprise", "$40 user/month", "Billed annually")],
  },
  pipedrive: {
    apiUrl: "https://support.pipedrive.com/en/article/how-can-i-find-my-personal-api-key",
    pricingUrl: "https://www.pipedrive.com/en/pricing",
    free: false, asOf: "Nov 2026",
    pricing: [row("Lite", "$14 seat/month", "Billed annually"), row("Growth", "$39 seat/month", "Billed annually"), row("Premium", "$59 seat/month", "Billed annually")],
  },
  bigquery: {
    apiUrl: "https://docs.cloud.google.com/bigquery/docs/authentication/getting-started",
    pricingUrl: "https://cloud.google.com/bigquery/pricing",
    free: true, asOf: "Nov 2026",
    pricing: [row("Free tier", "$0", "1 TiB queries, 10 GiB storage"), row("On-demand queries", "$6.25 per TiB", "After the free TiB"), row("Active storage", "From $0.02 per GiB", "Per month")],
  },
  postgres: {
    apiUrl: "https://www.postgresql.org/docs/current/auth-pg-hba-conf.html",
    pricingUrl: "https://www.postgresql.org/about/",
    free: true, asOf: "Nov 2026",
    pricing: [row("Open source", "Free", "Hosting cost is your own")],
  },
  snowflake: {
    apiUrl: "https://docs.snowflake.com/en/developer-guide/snowflake-rest-api/authentication",
    pricingUrl: "https://www.snowflake.com/en/pricing-options/calculator/overview/",
    free: false, asOf: "Nov 2026",
    pricing: [row("Trial", "$400 credits", "30 days"), row("Standard", "$2.00 per credit", "On demand, AWS US"), row("Enterprise", "$3.00 per credit", "On demand, AWS US")],
  },
  s3_lake: {
    apiUrl: "https://docs.aws.amazon.com/IAM/latest/UserGuide/id_credentials_access-keys.html",
    pricingUrl: "https://aws.amazon.com/s3/pricing/",
    free: true, asOf: "Nov 2026",
    pricing: [row("S3 Standard", "$0.023 per GB-month", "First 50 TB"), row("S3 Standard", "$0.022 per GB-month", "Next 450 TB"), row("Free tier", "Varies", "Check AWS for new accounts")],
  },
  airtable: {
    apiUrl: "https://airtable.com/developers/web/guides/personal-access-tokens",
    pricingUrl: "https://airtable.com/pricing",
    free: true, asOf: "Nov 2026",
    pricing: [row("Free", "$0", "1,000 API calls a month"), row("Team", "$20 user/month", "Annual; 100,000 calls"), row("Business", "$45 user/month", "Annual; unlimited calls")],
  },
  key_openai: {
    apiUrl: "https://developers.openai.com/api/docs/quickstart",
    pricingUrl: "https://developers.openai.com/api/docs/pricing",
    free: false, asOf: "Nov 2026",
    pricing: [row("Per model", "Per 1M tokens", "Input and output priced apart"), row("Batch / Flex", "50% off", "Versus standard rates")],
  },
  key_deepseek: {
    apiUrl: "https://api-docs.deepseek.com/",
    pricingUrl: "https://api-docs.deepseek.com/quick_start/pricing/",
    free: false, asOf: "Nov 2026",
    pricing: [row("deepseek-flash", "$0.30 in / $1.20 out", "Per 1M tokens, peak"), row("deepseek-flash", "$0.15 in / $0.60 out", "Per 1M tokens, off-peak"), row("deepseek-v4-pro", "$1.32 in / $3.96 out", "Per 1M tokens, peak")],
  },
  key_tavily: {
    apiUrl: "https://help.tavily.com/articles/9170796666-how-can-i-create-an-api-key",
    pricingUrl: "https://www.tavily.com/pricing",
    free: true, asOf: "Nov 2026",
    pricing: [row("Researcher", "Free", "1,000 credits a month"), row("Pay as you go", "$0.008 per credit", "No monthly commitment"), row("Project", "$30/month", "4,000 credits a month")],
  },
  key_apollo: {
    apiUrl: "https://docs.apollo.io/docs/create-api-key",
    pricingUrl: "https://www.apollo.io/pricing",
    free: true, asOf: "Nov 2026",
    pricing: [row("Free", "$0", "Limited credits and API calls"), row("Basic", "$49 user/month", "Annual"), row("Professional", "$79 user/month", "Annual")],
  },
  key_google_places: {
    apiUrl: "https://developers.google.com/maps/documentation/places/web-service/get-api-key",
    pricingUrl: "https://developers.google.com/maps/billing-and-pricing/pricing",
    free: true, asOf: "Nov 2026",
    pricing: [row("Place Details Essentials", "$5 per 1,000", "10,000 free a month"), row("Place Details Pro", "$17 per 1,000", "5,000 free a month"), row("Text Search Pro", "$32 per 1,000", "5,000 free a month")],
  },
  azure_ai_gateway: {
    apiUrl: "https://learn.microsoft.com/en-us/azure/foundry/foundry-models/concepts/endpoints",
    pricingUrl: "https://azure.microsoft.com/en-us/pricing/details/azure-openai/",
    free: false, asOf: "Nov 2026",
    pricing: [row("Per model", "Per 1M tokens", "Set by model and region")],
  },
  aws_bedrock_gateway: {
    apiUrl: "https://docs.aws.amazon.com/bedrock/latest/userguide/api-keys-generate.html",
    pricingUrl: "https://aws.amazon.com/bedrock/pricing/",
    free: false, asOf: "Nov 2026",
    pricing: [row("Mistral Large 3", "$0.50 in / $1.50 out", "Per 1M tokens, US"), row("DeepSeek v3.2", "$0.62 in / $1.85 out", "Per 1M tokens, US"), row("Batch inference", "50% off", "Select models")],
  },
  google_vertex_ai: {
    apiUrl: "https://docs.cloud.google.com/vertex-ai/generative-ai/docs/start/api-keys",
    pricingUrl: "https://cloud.google.com/vertex-ai/generative-ai/pricing",
    free: true, asOf: "Nov 2026",
    pricing: [row("Express mode", "$0", "Within quotas, new users"), row("Per model", "Per 1M tokens", "Set by model")],
  },
  private_vllm: {
    apiUrl: "https://docs.vllm.ai/en/latest/serving/online_serving/openai_compatible_server/",
    pricingUrl: "https://docs.vllm.ai/en/stable/getting_started/quickstart/",
    free: true, asOf: "Nov 2026",
    pricing: [row("Open source", "Free + your GPU", "Self-hosted")],
  },
};

// The connectors that name a provider key use key_ ids; the lookup is by connector id.
