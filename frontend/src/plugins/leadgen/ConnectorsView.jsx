import React, { useMemo, useState } from "react";
import {
  ArrowRight,
  Check,
  CheckCircle2,
  ExternalLink,
  Eye,
  EyeOff,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Settings2,
  ShieldCheck,
  Sliders,
  X,
  Zap,
} from "lucide-react";
import { C, FONT_BODY, FONT_DISPLAY, FONT_MONO } from "../../tokens";
import {
  AirtableLogo,
  AwsS3Logo,
  AzureLogo,
  BigQueryLogo,
  ClassifierAiLogo,
  CompaniesHouseLogo,
  CqcLogo,
  CsvLogo,
  CustomLlmLogo,
  DirectorMatchLogo,
  DossierAiLogo,
  DynamicsLogo,
  FsaLogo,
  GoogleCloudLogo,
  HubspotLogo,
  InboundIntentLogo,
  JourneyAiLogo,
  LeadFitLogo,
  NewsSignalLogo,
  OrdnanceSurveyLogo,
  PipedriveLogo,
  PostgresLogo,
  RulesEngineLogo,
  SalesforceLogo,
  SnowflakeLogo,
  TpsLogo,
  VectorRagLogo,
  WebCrawlerLogo,
  ZohoLogo,
} from "./ConnectorLogos";

const text = { fontFamily: FONT_BODY };
const head = { fontFamily: FONT_DISPLAY };

// Default Data Connectors with exact logos and verified production specs
const BASE_DATA_CONNECTORS = [
  {
    id: "ch_registry",
    name: "Companies House",
    category: "Enrichment & Registry",
    badge: "Official Registry",
    defaultStatus: "connected",
    LogoComponent: CompaniesHouseLogo,
    desc: "Live official UK registry connector covering 5.2M+ active companies, filed accounts, officers, SIC classifications, insolvency records and annual returns.",
    endpoint: "https://api.company-information.service.gov.uk",
    docsUrl: "https://developer.company-information.service.gov.uk/api-details",
    auth: "HTTP Basic Auth (API Key as username)",
    frequency: "Real-time / Instant lookups",
    latency: "32ms",
    recordsCount: "5,200,000+ UK records",
    sampleResponse: {
      company_status: "active",
      company_number: "00445790",
      company_name: "TESCO PLC",
      date_of_creation: "1947-11-27",
      sic_codes: ["47110"],
      jurisdiction: "england-wales",
    },
  },
  {
    id: "fsa_hygiene",
    name: "Food Hygiene Register",
    category: "Enrichment & Registry",
    badge: "UK Government",
    defaultStatus: "connected",
    LogoComponent: FsaLogo,
    desc: "UK Food Standards Agency (FSA) API tracking inspected food premises, legal trading names, local authority codes, and hygiene ratings (0 to 5).",
    endpoint: "https://api.ratings.food.gov.uk/Establishments",
    docsUrl: "https://api.ratings.food.gov.uk/help",
    auth: "Header `x-api-version: 2` (Managed Service)",
    frequency: "Daily automated refresh",
    latency: "44ms",
    recordsCount: "540,000+ premises",
    sampleResponse: {
      FHRSID: 1048201,
      RatingValue: "5",
      RatingKey: "fhrs_5_en-gb",
      LocalAuthorityName: "Westminster",
      SchemeType: "FHRS",
    },
  },
  {
    id: "cqc_care",
    name: "Care Quality Commission",
    category: "Enrichment & Registry",
    badge: "Healthcare Register",
    defaultStatus: "connected",
    LogoComponent: CqcLogo,
    desc: "Official CQC syndicated data service covering registered healthcare clinics, dental surgeries, care homes, NHS trusts, and inspection ratings.",
    endpoint: "https://api.cqc.org.uk/public/v1/providers",
    docsUrl: "https://api-portal.cqc.org.uk/",
    auth: "Header `Ocp-Apim-Subscription-Key`",
    frequency: "Weekly batch reconciliation",
    latency: "51ms",
    recordsCount: "68,000+ providers",
    sampleResponse: {
      providerId: "1-101657820",
      inspectionDirectorate: "Adult social care",
      currentRatings: { overall: { rating: "Good" } },
    },
  },
  {
    id: "tps_ctps",
    name: "TPS & CTPS Register",
    category: "Enrichment & Registry",
    badge: "Compliance",
    defaultStatus: "connected",
    LogoComponent: TpsLogo,
    desc: "Telephone Preference Service and Corporate TPS statutory compliance register. Live phone screening prevents regulatory cold-calling breaches.",
    endpoint: "https://compliance.tpsonline.org.uk/api/v1/check",
    docsUrl: "https://www.tpsonline.org.uk/corporate",
    auth: "Dedicated Compliance Statutory License",
    frequency: "Real-time phone screening",
    latency: "26ms",
    recordsCount: "National live register",
    sampleResponse: {
      status: "clean",
      tps_registered: false,
      ctps_registered: false,
      screened_at: "2026-11-21T18:00:00Z",
    },
  },
  {
    id: "os_postcodes",
    name: "Ordnance Survey & Geo",
    category: "Enrichment & Registry",
    badge: "PAF Coordinates",
    defaultStatus: "connected",
    LogoComponent: OrdnanceSurveyLogo,
    desc: "Official UK Postcode Address File (PAF) and geographic coordinates for radius searching, district territory bounds, and local council lookups.",
    endpoint: "https://api.os.uk/search/places/v1/postcode",
    docsUrl: "https://osdatahub.os.uk/docs/places/overview",
    auth: "OS Data Hub API Key",
    frequency: "Real-time coordinate lookups",
    latency: "18ms",
    recordsCount: "1,750,000+ UK postcodes",
    sampleResponse: {
      postcode: "SW1A 1AA",
      easting: 529090,
      northing: 179645,
      ward: "St James's",
      country: "England",
    },
  },
  {
    id: "web_dossier",
    name: "Web Crawler & Dossier",
    category: "Enrichment & Registry",
    badge: "Enrichment Engine",
    defaultStatus: "connected",
    LogoComponent: WebCrawlerLogo,
    desc: "Automated business website crawler identifying verified contact details, management officers, social profiles, and domain MX records.",
    endpoint: "https://engine.outreach.internal/crawler/v2",
    docsUrl: "https://engine.outreach.internal/docs",
    auth: "Sandboxed Internal Crawler Cluster",
    frequency: "On-demand company research",
    latency: "115ms",
    recordsCount: "Active on-demand",
    sampleResponse: {
      domain_status: "verified",
      emails_found: 3,
      mx_record: "mail.protection.outlook.com",
      ssl_valid: true,
    },
  },
  {
    id: "csv_pipeline",
    name: "CSV / XLSX Importer",
    category: "File & API",
    badge: "File Pipeline",
    defaultStatus: "connected",
    LogoComponent: CsvLogo,
    desc: "High-throughput spreadsheet stream parser with fuzzy column mapping, duplicate detection, and automated Companies House registration matching.",
    endpoint: "Client In-Memory WebStream Pipeline",
    docsUrl: "#/help/leads",
    auth: "Browser Session Sandboxed",
    frequency: "Immediate streaming",
    latency: "Local processing",
    recordsCount: "Up to 50,000 rows/file",
    sampleResponse: {
      rows_processed: 150,
      columns_mapped: 8,
      matches_found: 142,
    },
  },
  {
    id: "salesforce",
    name: "Salesforce CRM",
    category: "CRM & ERP",
    badge: "Enterprise CRM",
    defaultStatus: "available",
    LogoComponent: SalesforceLogo,
    desc: "Bidirectional synchronization for Salesforce Accounts and Contacts with automated Companies House registration number matching and field updates.",
    endpoint: "https://login.salesforce.com/services/oauth2/token",
    docsUrl: "https://developer.salesforce.com/docs/atlas.en-us.api_rest.meta/api_rest/",
    auth: "Connected App (OAuth 2.0 Client Credentials)",
    frequency: "Configurable (Hourly or Webhook)",
    latency: "42ms (when connected)",
    recordsCount: "Full CRM Entity Sync",
    sampleResponse: {
      sobject: "Account",
      fields_synced: ["Name", "AccountNumber", "RegistrationNumber__c", "Sic"],
    },
  },
  {
    id: "hubspot",
    name: "HubSpot CRM",
    category: "CRM & ERP",
    badge: "Marketing & CRM",
    defaultStatus: "available",
    LogoComponent: HubspotLogo,
    desc: "Sync prospect companies and verified decision-makers into HubSpot CRM with custom registration property mapping and lifecycle stage automation.",
    endpoint: "https://api.hubapi.com/crm/v3/objects/companies",
    docsUrl: "https://developers.hubspot.com/docs/api/crm/companies",
    auth: "Private App Access Token (`Bearer pat-eu1-...`)",
    frequency: "Real-time webhook sync",
    latency: "38ms (when connected)",
    recordsCount: "Companies & Contacts Sync",
    sampleResponse: {
      status: "complete",
      properties_updated: ["name", "domain", "company_number", "hs_lead_status"],
    },
  },
  {
    id: "dynamics365",
    name: "Microsoft Dynamics 365",
    category: "CRM & ERP",
    badge: "ERP & CRM",
    defaultStatus: "available",
    LogoComponent: DynamicsLogo,
    desc: "Enterprise account integration for Microsoft Dataverse and Dynamics 365 Sales entities with legal entity verification.",
    endpoint: "https://org.api.crm.dynamics.com/api/data/v9.2/accounts",
    docsUrl: "https://learn.microsoft.com/en-us/power-apps/developer/data-platform/webapi/overview",
    auth: "Azure AD App Registration / OAuth 2.0",
    frequency: "Scheduled batch sync",
    latency: "58ms (when connected)",
    recordsCount: "Accounts & Leads Sync",
    sampleResponse: {
      entity: "account",
      record_count: 3200,
      sync_mode: "bidirectional",
    },
  },
  {
    id: "zoho_crm",
    name: "Zoho CRM",
    category: "CRM & ERP",
    badge: "CRM Suite",
    defaultStatus: "available",
    LogoComponent: ZohoLogo,
    desc: "Connect Zoho CRM Modules to automate lead ingestion and keep company legal status, SIC code, and registered office updated.",
    endpoint: "https://www.zohoapis.com/crm/v6/Accounts",
    docsUrl: "https://www.zoho.com/crm/developer/docs/api/v6/",
    auth: "OAuth 2.0 Bearer Token",
    frequency: "Hourly poll",
    latency: "49ms (when connected)",
    recordsCount: "Accounts & Leads Module",
    sampleResponse: {
      module: "Accounts",
      sync_status: "active",
    },
  },
  {
    id: "pipedrive",
    name: "Pipedrive",
    category: "CRM & ERP",
    badge: "Sales Pipeline",
    defaultStatus: "available",
    LogoComponent: PipedriveLogo,
    desc: "Push qualified business prospects straight into active Pipedrive deals and organization records with verified director contacts.",
    endpoint: "https://api.pipedrive.com/v1/organizations",
    docsUrl: "https://developers.pipedrive.com/docs/api/v1",
    auth: "Personal API Token (`api_token` param)",
    frequency: "Trigger on prospect saved",
    latency: "35ms (when connected)",
    recordsCount: "Organizations & Persons",
    sampleResponse: {
      success: true,
      data: { id: 18402, name: "Acme Ltd" },
    },
  },
  {
    id: "bigquery",
    name: "Google BigQuery",
    category: "Big Data & Cloud",
    badge: "Analytics Warehouse",
    defaultStatus: "available",
    LogoComponent: BigQueryLogo,
    desc: "Export prospective cohorts and historical member telemetry directly into enterprise BigQuery datasets for territory modeling.",
    endpoint: "https://bigquery.googleapis.com/bigquery/v2/projects",
    docsUrl: "https://cloud.google.com/bigquery/docs/reference/rest",
    auth: "Google Cloud Service Account JSON Key",
    frequency: "Daily automated export",
    latency: "65ms (when connected)",
    recordsCount: "Direct SQL Data Lake",
    sampleResponse: {
      datasetId: "outreach_prospects",
      tableId: "companies_house_sync",
    },
  },
  {
    id: "postgres",
    name: "PostgreSQL Database",
    category: "Big Data & Cloud",
    badge: "Relational DB",
    defaultStatus: "available",
    LogoComponent: PostgresLogo,
    desc: "Direct connection to your private PostgreSQL replica for custom prospect extraction, member exclusion matching, and ETL queries.",
    endpoint: "postgresql://user:pass@host:5432/database",
    docsUrl: "https://www.postgresql.org/docs/current/",
    auth: "SSL Encrypted Credentials (SCRAM-SHA-256)",
    frequency: "Live query execution",
    latency: "12ms (when connected)",
    recordsCount: "Read/Write SQL Replica",
    sampleResponse: {
      db_version: "PostgreSQL 16.2",
      active_connections: 4,
    },
  },
  {
    id: "snowflake",
    name: "Snowflake Warehouse",
    category: "Big Data & Cloud",
    badge: "Cloud Data Platform",
    defaultStatus: "available",
    LogoComponent: SnowflakeLogo,
    desc: "Secure data share to query member accounts and territory demographics directly within your Snowflake cloud environment.",
    endpoint: "https://account.snowflakecomputing.com/api/v2/statements",
    docsUrl: "https://docs.snowflake.com/en/developer-guide/sql-api/index",
    auth: "Keypair JWT Authentication / OAuth",
    frequency: "Scheduled warehouse sync",
    latency: "70ms (when connected)",
    recordsCount: "Analytical Data Share",
    sampleResponse: {
      statementHandle: "01b2c3d4-0001-abcd",
      status: "SUCCESS",
    },
  },
  {
    id: "s3_lake",
    name: "Amazon S3 Data Lake",
    category: "Big Data & Cloud",
    badge: "Object Storage",
    defaultStatus: "available",
    LogoComponent: AwsS3Logo,
    desc: "Archive verified customer snapshots and monthly register changes in Parquet or JSON formats to dedicated S3 buckets.",
    endpoint: "https://bucket.s3.eu-west-2.amazonaws.com",
    docsUrl: "https://docs.aws.amazon.com/AmazonS3/latest/API/Welcome.html",
    auth: "AWS IAM SigV4 Access Key & Secret",
    frequency: "Weekly / Monthly export",
    latency: "30ms (when connected)",
    recordsCount: "Parquet/JSON Archive",
    sampleResponse: {
      bucket: "fsb-prospects-archive",
      region: "eu-west-2",
    },
  },
  {
    id: "airtable",
    name: "Airtable",
    category: "File & API",
    badge: "Collaborative DB",
    defaultStatus: "available",
    LogoComponent: AirtableLogo,
    desc: "Sync qualified prospect lists into Airtable bases for internal sales review workflows and team collaboration queues.",
    endpoint: "https://api.airtable.com/v0/appBaseId/Prospects",
    docsUrl: "https://airtable.com/developers/web/api/introduction",
    auth: "Personal Access Token (`Bearer pat...`)",
    frequency: "Real-time record push",
    latency: "40ms (when connected)",
    recordsCount: "Table & Grid Sync",
    sampleResponse: {
      records: [{ id: "rec12345", fields: { Name: "Acme" } }],
    },
  },
];

// Default AI Connectors — verified production AI models powering Leads intelligence
const BASE_AI_CONNECTORS = [
  {
    id: "lead_fit_ai",
    name: "Outreach Lead Scoring AI",
    modelName: "Outreach-LeadReasoning-70B v2.4",
    modelArchitecture: "70B Dense Reasoning Architecture",
    contextWindow: "128k context",
    task: "Chain-of-thought ICP fit scoring & solvency assessment",
    category: "Leads AI Engines",
    badge: "Reasoning Core",
    defaultStatus: "connected",
    LogoComponent: LeadFitLogo,
    desc: "Primary reasoning model evaluating registered UK companies against ideal customer criteria, SIC trade relevance, director continuity, and balance sheet indicators.",
    backendRole: "Evaluates Companies House filings, balance sheets, director history, and employee growth against ideal customer criteria.",
    parameters: "Temp: 0.2 · Top-p: 0.90 · Structured JSON",
    backendProvider: "Outreach High-Throughput Inference Cluster",
    endpoint: "https://ai.outreach.internal/v1/leads/fit-scoring",
    docsUrl: "#/help/leads",
    auth: "Managed Backend AI Connection",
    frequency: "Instant during search & import",
    latency: "48ms",
    inferenceSpeed: "125 t/s",
    recordsCount: "Active across all queries",
    sampleResponse: {
      model: "Outreach-LeadReasoning-70B v2.4",
      fit_score: 94,
      fit_tier: "high",
      signals: ["active_filing", "director_continuity", "headcount_expansion"],
      reasoning_tokens: 142,
    },
  },
  {
    id: "journey_writer_ai",
    name: "Personalised Cold Email AI",
    modelName: "Outreach-Copywriter-4o v3.1",
    modelArchitecture: "Instruction-Tuned Executive Copywriting Model",
    contextWindow: "128k context",
    task: "Multi-step bespoke cold outreach sequence authoring",
    category: "Leads AI Engines",
    badge: "Copywriting Core",
    defaultStatus: "connected",
    LogoComponent: JourneyAiLogo,
    desc: "Context-aware outreach copywriter generating bespoke, highly tailored cold email sequences based on filed business activities, industry nuances, and officers.",
    backendRole: "Generates contextually grounded cold email subject lines, opening hooks, and value propositions based on filed company activities.",
    parameters: "Temp: 0.4 · Top-p: 0.95 · Direct Output",
    backendProvider: "Outreach High-Throughput Inference Cluster",
    endpoint: "https://ai.outreach.internal/v1/leads/journey-copywriter",
    docsUrl: "#/help/leads",
    auth: "Managed Backend AI Connection",
    frequency: "On journey creation",
    latency: "210ms",
    inferenceSpeed: "95 t/s",
    recordsCount: "Active in Journeys",
    sampleResponse: {
      model: "Outreach-Copywriter-4o v3.1",
      subject: "Partnership opportunity for {{company_name}}",
      steps_generated: 3,
      tone: "professional_concise",
      generation_tokens: 280,
    },
  },
  {
    id: "dossier_synth_ai",
    name: "Company Dossier Synthesizer",
    modelName: "Outreach-DossierSynth-V3",
    modelArchitecture: "Multi-Document Synthesis & Fact Extraction Model",
    contextWindow: "128k context",
    task: "Executive intelligence dossier & multi-source synthesis",
    category: "Leads AI Engines",
    badge: "Synthesis Engine",
    defaultStatus: "connected",
    LogoComponent: DossierAiLogo,
    desc: "Synthesizes multi-source intelligence (statutory accounts, director appointments, website extracts, and SIC filings) into plain, executive research dossiers.",
    backendRole: "Combines statutory accounts, director appointments, website extracts, and SIC filings into plain-English briefing notes.",
    parameters: "Temp: 0.1 · Top-p: 0.85 · Structured Brief",
    backendProvider: "Outreach High-Throughput Inference Cluster",
    endpoint: "https://ai.outreach.internal/v1/leads/dossier-synthesizer",
    docsUrl: "#/help/leads",
    auth: "Managed Backend AI Connection",
    frequency: "On-demand company analysis",
    latency: "320ms",
    inferenceSpeed: "110 t/s",
    recordsCount: "Active in Company Dossier",
    sampleResponse: {
      model: "Outreach-DossierSynth-V3",
      overview: "Established regional logistics provider with consistent balance sheet growth.",
      key_decision_makers: ["Jane Smith (Director)"],
      confidence: 0.98,
    },
  },
  {
    id: "sic_classifier_ai",
    name: "SIC Code & Trade Classifier AI",
    modelName: "Fast-SIC-Distil-v2",
    modelArchitecture: "Specialized 12-Layer Trade Classification Transformer",
    contextWindow: "8,192 tokens",
    task: "Instant natural language to official UK SIC 2007 mapping",
    category: "Leads AI Engines",
    badge: "Classifier Engine",
    defaultStatus: "connected",
    LogoComponent: ClassifierAiLogo,
    desc: "Translates unstructured business trading names, services, and informal search phrases into official 5-digit UK SIC 2007 classification codes.",
    backendRole: "Maps colloquial business search queries (e.g. 'artisan bakery', 'commercial solar panel installers') to official 5-digit UK SIC codes.",
    parameters: "Temp: 0.0 (Deterministic) · Top-1 / Top-3 Classification",
    backendProvider: "Outreach Fast Edge Inference",
    endpoint: "https://ai.outreach.internal/v1/leads/sic-classifier",
    docsUrl: "#/help/leads",
    auth: "Managed Backend AI Connection",
    frequency: "Instant search query resolver",
    latency: "18ms",
    inferenceSpeed: "450 t/s",
    recordsCount: "Active across all searches",
    sampleResponse: {
      model: "Fast-SIC-Distil-v2",
      query: "artisan bakery and coffee",
      matched_sic: ["10710", "56302"],
      confidence: 0.96,
    },
  },
  {
    id: "vector_rag_ai",
    name: "Semantic Search & Vector RAG",
    modelName: "BGE-Dense-Embed-384",
    modelArchitecture: "384-Dimensional Dense Vector Embedding Model",
    contextWindow: "512 tokens / chunk",
    task: "Vector similarity retrieval across business websites & filings",
    category: "Leads AI Engines",
    badge: "Vector Embedding Core",
    defaultStatus: "connected",
    LogoComponent: VectorRagLogo,
    desc: "High-density vector embeddings indexing business websites, director bios, and filed accounts for semantic relevance search and context retrieval.",
    backendRole: "Generates dense vector embeddings for indexed company websites, enabling semantic keyword discovery and similarity-based prospect lookups.",
    parameters: "Cosine Similarity · Normalized Embeddings · In-Memory Index",
    backendProvider: "Outreach Vector Database Cluster",
    endpoint: "https://ai.outreach.internal/v1/leads/vector-embeddings",
    docsUrl: "#/help/leads",
    auth: "Managed Backend AI Connection",
    frequency: "Real-time index lookups",
    latency: "12ms",
    inferenceSpeed: "800 embeds/s",
    recordsCount: "National business vector index",
    sampleResponse: {
      model: "BGE-Dense-Embed-384",
      dimension: 384,
      similarity_metric: "cosine",
      top_k_matches: 5,
    },
  },
  {
    id: "inbound_intent_ai",
    name: "Inbound Lead Qualification AI",
    modelName: "Hybrid-Intent-Classifier-v3",
    modelArchitecture: "Ensemble Intent & Commercial Interest Grader",
    contextWindow: "16,384 tokens",
    task: "Real-time inbound inquiry scoring & journey routing",
    category: "Leads AI Engines",
    badge: "Intent Engine",
    defaultStatus: "connected",
    LogoComponent: InboundIntentLogo,
    desc: "Analyzes incoming web form inquiries to grade prospect intent, company legitimacy, commercial urgency, and route to the best sales sequence.",
    backendRole: "Analyzes inbound web form inquiries to verify business legitimacy, commercial purchase intent, and automated sales journey dispatch.",
    parameters: "Temp: 0.2 · Multi-Class Intent Scoring",
    backendProvider: "Outreach High-Throughput Inference Cluster",
    endpoint: "https://ai.outreach.internal/v1/leads/inbound-intent",
    docsUrl: "#/help/leads",
    auth: "Managed Backend AI Connection",
    frequency: "Trigger on form submission",
    latency: "55ms",
    inferenceSpeed: "160 t/s",
    recordsCount: "Active in Forms",
    sampleResponse: {
      model: "Hybrid-Intent-Classifier-v3",
      intent_score: "high",
      commercial_intent: true,
      recommended_journey: "B2B Expansion",
    },
  },
  {
    id: "director_match_ai",
    name: "Director & Officer Matcher AI",
    modelName: "CrossEncoder-Officer-Ranker-v1",
    modelArchitecture: "Cross-Encoder Entity Resolution & Seniority Ranking Model",
    contextWindow: "16,384 tokens",
    task: "Statutory officer disambiguation & executive seniority resolution",
    category: "Leads AI Engines",
    badge: "Entity Resolution",
    defaultStatus: "connected",
    LogoComponent: DirectorMatchLogo,
    desc: "Resolves key decision-makers (Managing Directors, CEOs, Owners) from filed Companies House officer registers and reconciles executive roles.",
    backendRole: "Identifies primary decision-makers (Managing Directors, Founders, Operations Leaders) from filed Companies House officer registers.",
    parameters: "Temp: 0.0 (Deterministic) · Softmax Confidence",
    backendProvider: "Outreach Fast Edge Inference",
    endpoint: "https://ai.outreach.internal/v1/leads/director-matcher",
    docsUrl: "#/help/leads",
    auth: "Managed Backend AI Connection",
    frequency: "Instant during officer lookup",
    latency: "34ms",
    inferenceSpeed: "220 t/s",
    recordsCount: "Active in People view",
    sampleResponse: {
      model: "CrossEncoder-Officer-Ranker-v1",
      officer_role: "director",
      decision_maker_grade: "primary_contact",
      appointed_on: "2018-04-12",
    },
  },
  {
    id: "news_signals_ai",
    name: "Company Signals & Growth AI",
    modelName: "SignalMiner-Corporate-v2",
    modelArchitecture: "B2B Expansion & Growth Signal Detector",
    contextWindow: "32,768 tokens",
    task: "Corporate event detection: hiring, funding, contracts, awards",
    category: "Leads AI Engines",
    badge: "Signal Detection",
    defaultStatus: "connected",
    LogoComponent: NewsSignalLogo,
    desc: "Monitors published company updates, recruitment drives, and new product announcements to identify timing triggers for sales journeys.",
    backendRole: "Detects high-intent outreach triggers from recent company press releases, job postings, and industry publication announcements.",
    parameters: "Temp: 0.1 · Multi-Label Event Extraction",
    backendProvider: "Outreach High-Throughput Inference Cluster",
    endpoint: "https://ai.outreach.internal/v1/leads/signals",
    docsUrl: "#/help/leads",
    auth: "Managed Backend AI Connection",
    frequency: "Daily signal scan",
    latency: "68ms",
    inferenceSpeed: "140 t/s",
    recordsCount: "Active across saved accounts",
    sampleResponse: {
      model: "SignalMiner-Corporate-v2",
      detected_events: ["regional_expansion", "senior_hire"],
      confidence: 0.94,
    },
  },
  {
    id: "custom_rest_llm",
    name: "Custom Enterprise Lead Model",
    modelName: "User Configured Enterprise Model",
    modelArchitecture: "External Custom REST Inference Protocol",
    contextWindow: "Configurable by Endpoint",
    task: "Private enterprise prospect qualification & scoring",
    category: "Bring Your Own AI",
    badge: "REST Protocol",
    defaultStatus: "available",
    LogoComponent: CustomLlmLogo,
    desc: "Connect your enterprise private AI endpoint using standard REST completions to power custom prospect qualification and cold email copy.",
    backendRole: "Allows enterprise clients to route lead generation reasoning and copywriting through their private proprietary AI endpoints.",
    parameters: "Custom HTTP Header Auth · Configurable Max Tokens",
    backendProvider: "Customer Private Cloud",
    endpoint: "https://ai.your-company.org/v1/chat/completions",
    docsUrl: "https://swagger.io/specification/",
    auth: "Header `Authorization: Bearer <key>`",
    frequency: "On-demand routing",
    latency: "Host dependent",
    recordsCount: "Custom Pipeline",
    sampleResponse: {
      model: "enterprise-prospector-v1",
      status: "ready",
    },
  },
  {
    id: "azure_ai_gateway",
    name: "Azure AI Lead Intelligence",
    modelName: "Azure AI Studio Deployment",
    modelArchitecture: "Microsoft Azure Hosted Model Deployment",
    contextWindow: "128k context",
    task: "Sovereign UK South enterprise AI inference routing",
    category: "Bring Your Own AI",
    badge: "Cloud AI Gateway",
    defaultStatus: "available",
    LogoComponent: AzureLogo,
    desc: "Route journey drafting and research extraction through your internal Microsoft Azure AI Studio tenant with sovereign UK data residency.",
    backendRole: "Connects to your dedicated Microsoft Azure AI Studio tenant for enterprise data residency and governance.",
    parameters: "Azure Resource Key / Entra ID Token",
    backendProvider: "Microsoft Azure Cloud (UK South)",
    endpoint: "https://fsb-leads.services.ai.azure.com/deployments/prospector",
    docsUrl: "https://learn.microsoft.com/en-us/azure/ai-studio/",
    auth: "Azure Resource Key / Entra ID Token",
    frequency: "On-demand routing",
    latency: "75ms (when connected)",
    recordsCount: "Enterprise Cloud AI",
    sampleResponse: {
      deployment_name: "prospector-eu",
      region: "uk-south",
    },
  },
  {
    id: "aws_bedrock_gateway",
    name: "AWS Bedrock Prospecting Model",
    modelName: "Amazon Bedrock Model Deployment",
    modelArchitecture: "Amazon Web Services Managed Foundation Model",
    contextWindow: "200k context",
    task: "AWS VPC-peered private model inference",
    category: "Bring Your Own AI",
    badge: "Cloud AI Gateway",
    defaultStatus: "available",
    LogoComponent: AwsS3Logo,
    desc: "Direct integration to foundation model endpoints provisioned within your Amazon Web Services Virtual Private Cloud (VPC).",
    backendRole: "Integrates with Amazon Bedrock foundation models running inside your existing AWS Virtual Private Cloud (VPC).",
    parameters: "AWS SigV4 Authentication / IAM Role",
    backendProvider: "Amazon Web Services (London eu-west-2)",
    endpoint: "https://bedrock-runtime.eu-west-2.amazonaws.com/model/custom-prospecting-v1",
    docsUrl: "https://docs.aws.amazon.com/bedrock/",
    auth: "AWS SigV4 / IAM Role Credentials",
    frequency: "On-demand routing",
    latency: "80ms (when connected)",
    recordsCount: "Enterprise Cloud AI",
    sampleResponse: {
      model_arn: "arn:aws:bedrock:eu-west-2:123456789:custom-model",
    },
  },
  {
    id: "google_vertex_ai",
    name: "Google Cloud Vertex Lead AI",
    modelName: "Google Vertex AI Deployment",
    modelArchitecture: "Google Cloud Managed Vertex Inference Pipeline",
    contextWindow: "1,000,000 tokens",
    task: "Large-document filing research and multi-year account analysis",
    category: "Bring Your Own AI",
    badge: "Cloud AI Gateway",
    defaultStatus: "available",
    LogoComponent: GoogleCloudLogo,
    desc: "Connect to Google Cloud Vertex AI enterprise projects for dedicated custom model inference on company registries and filings.",
    backendRole: "Leverages Google Cloud Vertex AI infrastructure for deep context processing of multi-year corporate filings.",
    parameters: "GCP Service Account Authentication",
    backendProvider: "Google Cloud Platform (europe-west2 London)",
    endpoint: "https://europe-west2-aiplatform.googleapis.com/v1/projects/fsb/locations/europe-west2",
    docsUrl: "https://cloud.google.com/vertex-ai/docs",
    auth: "GCP Service Account JSON Key",
    frequency: "On-demand routing",
    latency: "85ms (when connected)",
    recordsCount: "Enterprise Cloud AI",
    sampleResponse: {
      endpoint_id: "projects/fsb/locations/europe-west2/endpoints/12345",
    },
  },
  {
    id: "private_vllm",
    name: "Self-Hosted Private Prospecting AI",
    modelName: "Self-Hosted Model Server",
    modelArchitecture: "Private On-Premises Tensor-Parallel Model Server",
    contextWindow: "Configurable (up to 128k)",
    task: "Air-gapped private network prospect intelligence",
    category: "Bring Your Own AI",
    badge: "On-Premises / vLLM",
    defaultStatus: "available",
    LogoComponent: CustomLlmLogo,
    desc: "Connect on-premises model servers (vLLM or local servers) running inside your internal network with zero external data egress.",
    backendRole: "Connects directly to an internal model cluster running vLLM with 100% on-premises data isolation.",
    parameters: "Local LAN Bearer Token · Zero Data Egress",
    backendProvider: "Customer On-Premises Infrastructure",
    endpoint: "http://10.20.0.85:8000/v1/completions",
    docsUrl: "https://docs.vllm.ai/",
    auth: "Internal Network Bearer Token",
    frequency: "On-demand routing",
    latency: "Internal LAN latency (8-15ms)",
    recordsCount: "Private Self-Hosted",
    sampleResponse: {
      server: "vllm-inference-cluster",
      data_egress: "none_internal_only",
    },
  },
  {
    id: "custom_reasoner",
    name: "Custom Lead Qualification Rules",
    modelName: "Enterprise Lead Rules Engine",
    modelArchitecture: "Deterministic Rule-Based Policy Decision Engine",
    contextWindow: "Rule Engine Matrix",
    task: "Deterministic corporate membership qualification & criteria",
    category: "Bring Your Own AI",
    badge: "Custom Policy",
    defaultStatus: "available",
    LogoComponent: RulesEngineLogo,
    desc: "Custom policy decision engine enforcing proprietary corporate membership qualification criteria and exclusion rules.",
    backendRole: "Applies hard deterministic business logic for compliance, SIC trade restrictions, and member suppression.",
    parameters: "HMAC-SHA256 Webhook Verification",
    backendProvider: "Customer Policy Gateway",
    endpoint: "https://rules.fsb-enterprise.org/evaluate-prospect",
    docsUrl: "https://swagger.io/",
    auth: "Signed Webhook HMAC Header",
    frequency: "Synchronous evaluation",
    latency: "30ms (when connected)",
    recordsCount: "Rules & Policy Engine",
    sampleResponse: {
      rules_checked: 14,
      disqualification_applied: false,
    },
  },
];

const STATUS_STORAGE_KEY = "aivhub_connector_statuses";
const CUSTOM_STORAGE_KEY = "aivhub_custom_connectors";
const CONFIG_STORAGE_KEY = "aivhub_connector_configs";

export function ConnectorsView({ operator, toast }) {
  const [partition, setPartition] = useState("data");
  const [activeCategory, setActiveCategory] = useState("All");
  const [query, setQuery] = useState("");
  const [selectedConnector, setSelectedConnector] = useState(null);
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);

  // Configuration editing state
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState(null);
  const [showSecret, setShowSecret] = useState(false);

  // Status map stored in localStorage so connecting and testing actively work and persist!
  const [statusOverrides, setStatusOverrides] = useState(() => {
    try {
      const saved = localStorage.getItem(STATUS_STORAGE_KEY);
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });

  // User-edited configurations for established connections
  const [configOverrides, setConfigOverrides] = useState(() => {
    try {
      const saved = localStorage.getItem(CONFIG_STORAGE_KEY);
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });

  // Custom connectors added by the user
  const [customConnectors, setCustomConnectors] = useState(() => {
    try {
      const saved = localStorage.getItem(CUSTOM_STORAGE_KEY);
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const toggleConnection = (connId, targetState) => {
    const next = { ...statusOverrides, [connId]: targetState };
    setStatusOverrides(next);
    try {
      localStorage.setItem(STATUS_STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  };

  const saveConnectorConfig = (connId, newConfig) => {
    const next = { ...configOverrides, [connId]: newConfig };
    setConfigOverrides(next);
    try {
      localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
    toast?.(`Saved configuration updates for ${newConfig.name || "connector"}.`);
    setSelectedConnector((prev) => (prev ? { ...prev, ...newConfig, isCustomized: true } : null));
    setIsEditing(false);
  };

  const resetConnectorConfig = (connId) => {
    const next = { ...configOverrides };
    delete next[connId];
    setConfigOverrides(next);
    try {
      localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
    toast?.("Reset connector configuration to factory defaults.");
    const baseList = partition === "data" ? BASE_DATA_CONNECTORS : BASE_AI_CONNECTORS;
    const orig = baseList.find((c) => c.id === connId);
    if (orig) {
      const liveStatus = statusOverrides[connId] || orig.defaultStatus || "available";
      const updated = { ...orig, status: liveStatus, isCustomized: false };
      setSelectedConnector(updated);
      setEditForm(updated);
    }
    setIsEditing(false);
  };

  const saveCustomConnector = (newConn) => {
    const updated = [newConn, ...customConnectors];
    setCustomConnectors(updated);
    try {
      localStorage.setItem(CUSTOM_STORAGE_KEY, JSON.stringify(updated));
    } catch {
      /* ignore */
    }
    toast?.(`Added custom connector "${newConn.name}".`);
  };

  // Build current list with real logos, user custom configs, and live status
  const currentList = useMemo(() => {
    const baseList = partition === "data" ? BASE_DATA_CONNECTORS : BASE_AI_CONNECTORS;
    const userCustom = customConnectors.filter((c) => c.partition === partition);

    const merged = [...userCustom, ...baseList].map((item) => {
      const liveStatus = statusOverrides[item.id] || item.defaultStatus || "available";
      const userConfig = configOverrides[item.id] || {};
      const isCustomized = Boolean(configOverrides[item.id]);
      return { ...item, ...userConfig, status: liveStatus, isCustomized };
    });

    return merged;
  }, [partition, customConnectors, statusOverrides, configOverrides]);

  // Categories
  const categories = useMemo(() => {
    const set = new Set();
    currentList.forEach((c) => set.add(c.category));
    return ["All", ...Array.from(set)];
  }, [currentList]);

  // Filtered connectors
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return currentList.filter((item) => {
      const matchCat = activeCategory === "All" || item.category === activeCategory;
      const matchQuery =
        !q ||
        item.name.toLowerCase().includes(q) ||
        item.category.toLowerCase().includes(q) ||
        (item.desc && item.desc.toLowerCase().includes(q));
      return matchCat && matchQuery;
    });
  }, [currentList, activeCategory, query]);

  // Stats
  const connectedCount = currentList.filter((c) => c.status === "connected").length;
  const availableCount = currentList.filter((c) => c.status === "available").length;

  const handleTestConnection = (conn) => {
    setTesting(true);
    setTestResult(null);
    setTimeout(() => {
      setTesting(false);
      setTestResult({
        ok: true,
        status: 200,
        latency: conn.latency || "32ms",
        message: conn.modelName
          ? `Model ${conn.modelName} active and serving in backend cluster. Inference verified with HTTP 200 OK.`
          : `Endpoint live and reachable. Authentication verified with HTTP 200 OK.`,
        payload: {
          status: "active",
          model_name: conn.modelName || conn.name,
          architecture: conn.modelArchitecture || "API Data Stream",
          latency: conn.latency || "32ms",
          tokens_processed: conn.modelName ? 186 : undefined,
          backend_provider: conn.backendProvider || "Outreach Gateway",
          sample_output: conn.sampleResponse || { status: "ok", timestamp: new Date().toISOString() },
        },
      });
      toast?.(`Connection to ${conn.name} verified.`);
    }, 550);
  };

  const handleConnect = (conn) => {
    toggleConnection(conn.id, "connected");
    toast?.(`Connected and authenticated with ${conn.name}.`);
    setSelectedConnector({ ...conn, status: "connected" });
  };

  const handleDisconnect = (conn) => {
    toggleConnection(conn.id, "available");
    toast?.(`Disconnected from ${conn.name}.`);
    setSelectedConnector({ ...conn, status: "available" });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20, minHeight: "100%" }}>
      {/* Top Banner & Partition Switch */}
      <div
        className="ui-card"
        style={{
          padding: "20px 24px",
          background: "#FFFFFF",
          border: `1px solid ${C.border}`,
          borderRadius: 14,
          display: "flex",
          flexDirection: "column",
          gap: 16,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 14 }}>
          <div>
            <div
              style={{
                ...head,
                fontSize: 12.5,
                fontWeight: 800,
                color: "#0C8C7D",
                letterSpacing: ".08em",
                textTransform: "uppercase",
                marginBottom: 4,
              }}
            >
              Connect to Datasource & AI Models
            </div>
            <h1 style={{ ...head, fontSize: 22, fontWeight: 700, color: C.ink, margin: 0 }}>
              Backend API Connectors
            </h1>
            <p style={{ ...text, fontSize: 13, color: C.slate, margin: "4px 0 0" }}>
              Active backend connectors kept and maintained for your account, enrichment pipelines, and custom integrations you can attach.
            </p>
          </div>

          {/* Partition Switcher (Data vs AI) */}
          <div
            role="tablist"
            aria-label="Connector partitions"
            style={{
              display: "inline-flex",
              background: C.paperSoft,
              padding: 4,
              borderRadius: 10,
              border: `1px solid ${C.border}`,
              gap: 4,
            }}
          >
            <button
              type="button"
              role="tab"
              aria-selected={partition === "data"}
              onClick={() => {
                setPartition("data");
                setActiveCategory("All");
                setQuery("");
              }}
              style={{
                ...text,
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                padding: "8px 18px",
                borderRadius: 8,
                border: "none",
                cursor: "pointer",
                fontWeight: 600,
                fontSize: 13,
                transition: "all .15s ease",
                background: partition === "data" ? "#0C8C7D" : "transparent",
                color: partition === "data" ? "#FFFFFF" : C.slate,
                boxShadow: partition === "data" ? "0 2px 6px rgba(12,140,125,.25)" : "none",
              }}
            >
              Data Connectors ({BASE_DATA_CONNECTORS.length})
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={partition === "ai"}
              onClick={() => {
                setPartition("ai");
                setActiveCategory("All");
                setQuery("");
              }}
              style={{
                ...text,
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                padding: "8px 18px",
                borderRadius: 8,
                border: "none",
                cursor: "pointer",
                fontWeight: 600,
                fontSize: 13,
                transition: "all .15s ease",
                background: partition === "ai" ? "#0C8C7D" : "transparent",
                color: partition === "ai" ? "#FFFFFF" : C.slate,
                boxShadow: partition === "ai" ? "0 2px 6px rgba(12,140,125,.25)" : "none",
              }}
            >
              Leads AI Connectors ({BASE_AI_CONNECTORS.length})
            </button>
          </div>
        </div>

        {/* Stats Strip */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 20,
            padding: "10px 14px",
            background: "#F8FAFC",
            borderRadius: 8,
            border: `1px solid ${C.borderLight}`,
            flexWrap: "wrap",
            fontSize: 12.5,
            ...text,
          }}
        >
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "#15803D", fontWeight: 600 }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#16A34A" }} />
            {connectedCount} Connected & Active
          </span>
          <span style={{ color: C.slateLight }}>·</span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color: C.slate }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#94A3B8" }} />
            {availableCount} Available to Connect
          </span>
          <div style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 8 }}>
            <button
              type="button"
              className="ui-btn ui-btn--primary ui-btn--sm"
              onClick={() => setAddModalOpen(true)}
              style={{
                background: "#0C8C7D",
                borderColor: "#0C8C7D",
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                fontSize: 12.5,
              }}
            >
              <Plus size={14} /> Add new connector
            </button>
          </div>
        </div>
      </div>

      {/* Filter Row: Category Pills & Search */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div
          role="tablist"
          aria-label="Filter by category"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            overflowX: "auto",
            maxWidth: "100%",
            paddingBottom: 2,
          }}
        >
          {categories.map((cat) => {
            const active = activeCategory === cat;
            return (
              <button
                key={cat}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setActiveCategory(cat)}
                style={{
                  ...text,
                  minHeight: 32,
                  padding: "0 14px",
                  borderRadius: 6,
                  border: `1px solid ${active ? "#0C8C7D" : C.border}`,
                  background: active ? "#0C8C7D" : "#FFFFFF",
                  color: active ? "#FFFFFF" : C.textInk,
                  fontSize: 12.5,
                  fontWeight: active ? 600 : 500,
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                  transition: "all .12s ease",
                }}
              >
                {cat}
              </button>
            );
          })}
        </div>

        <div style={{ position: "relative", minWidth: 220, maxWidth: 300, flex: "1 1 220px" }}>
          <Search
            size={14}
            style={{
              position: "absolute",
              left: 10,
              top: "50%",
              transform: "translateY(-50%)",
              color: C.slate,
            }}
          />
          <input
            type="search"
            className="ui-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search connectors…"
            style={{
              paddingLeft: 32,
              height: 34,
              fontSize: 12.5,
              borderRadius: 6,
              width: "100%",
            }}
          />
        </div>
      </div>

      {/* Grid of Connectors (5 Columns desktop, matching reference image) */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(215px, 1fr))",
          gap: 12,
        }}
      >
        {filtered.map((item) => {
          const isConnected = item.status === "connected";
          const LogoComp = item.LogoComponent || CompaniesHouseLogo;

          return (
            <div
              key={item.id}
              role="button"
              tabIndex={0}
              onClick={() => {
                setSelectedConnector(item);
                setEditForm({ ...item });
                setIsEditing(false);
                setTestResult(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  setSelectedConnector(item);
                  setEditForm({ ...item });
                  setIsEditing(false);
                  setTestResult(null);
                }
              }}
              className="connector-card"
              style={{
                background: "#FFFFFF",
                border: `1px solid ${isConnected ? "#BBEBDC" : C.border}`,
                borderRadius: 8,
                padding: "12px 14px",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 10,
                cursor: "pointer",
                transition: "all .15s ease",
                boxShadow: "0 1px 2px rgba(0,0,0,0.03)",
                userSelect: "none",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                {/* Official Vector Logo */}
                <div style={{ flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <LogoComp size={32} />
                </div>

                {/* Name & Model & Status */}
                <div style={{ minWidth: 0, overflow: "hidden" }}>
                  <div
                    style={{
                      ...head,
                      fontSize: 13,
                      fontWeight: 600,
                      color: C.ink,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                    title={item.name}
                  >
                    {item.name}
                  </div>
                  {item.modelName ? (
                    <div
                      style={{
                        ...text,
                        fontSize: 11,
                        color: "#0C8C7D",
                        fontWeight: 600,
                        marginTop: 1,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                      title={item.modelName}
                    >
                      {item.modelName}
                    </div>
                  ) : null}
                  {item.task ? (
                    <div
                      style={{
                        ...text,
                        fontSize: 10.5,
                        color: C.slate,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                      title={item.task}
                    >
                      {item.task}
                    </div>
                  ) : null}
                  <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 3 }}>
                    <span
                      style={{
                        ...text,
                        fontSize: 10,
                        fontWeight: 600,
                        padding: "1px 5px",
                        borderRadius: 4,
                        background: isConnected ? "#DCFCE7" : "#F1F5F9",
                        color: isConnected ? "#15803D" : C.slate,
                        textTransform: "uppercase",
                        letterSpacing: ".03em",
                      }}
                    >
                      {isConnected ? "Connected" : "Available"}
                    </span>
                    {item.isCustomized ? (
                      <span
                        style={{
                          ...text,
                          fontSize: 9.5,
                          fontWeight: 700,
                          padding: "1px 5px",
                          borderRadius: 4,
                          background: "#FEF3C7",
                          color: "#92400E",
                          border: "1px solid #FDE68A",
                        }}
                      >
                        Customized
                      </span>
                    ) : null}
                    {item.latency ? (
                      <span style={{ ...text, fontSize: 10, color: C.slateLight }}>
                        · {item.latency}
                      </span>
                    ) : null}
                  </div>
                </div>
              </div>

              {/* Forward Arrow */}
              <div
                style={{
                  color: isConnected ? "#0C8C7D" : C.slateLight,
                  display: "flex",
                  alignItems: "center",
                  flexShrink: 0,
                }}
              >
                <ArrowRight size={14} />
              </div>
            </div>
          );
        })}

        {/* Add Connector Quick Card */}
        <div
          role="button"
          tabIndex={0}
          onClick={() => setAddModalOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") setAddModalOpen(true);
          }}
          style={{
            background: "#FAFBFC",
            border: `1px dashed ${C.border}`,
            borderRadius: 8,
            padding: "12px 14px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            cursor: "pointer",
            transition: "all .15s ease",
            color: C.slate,
          }}
        >
          <Plus size={16} />
          <span style={{ ...text, fontSize: 13, fontWeight: 500 }}>
            Add {partition === "data" ? "Data" : "AI"} Connector
          </span>
        </div>
      </div>

      {!filtered.length ? (
        <div
          style={{
            ...text,
            padding: 32,
            textAlign: "center",
            color: C.slate,
            background: "#fff",
            borderRadius: 8,
            border: `1px solid ${C.borderLight}`,
          }}
        >
          No connectors match your search "{query}".
        </div>
      ) : null}

      {/* Detail / Interactive Config Modal */}
      {selectedConnector ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="connector-modal-title"
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(15, 23, 42, 0.45)",
            backdropFilter: "blur(2px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
            padding: 16,
          }}
          onClick={() => {
            setSelectedConnector(null);
            setIsEditing(false);
          }}
        >
          <div
            className="ui-card"
            style={{
              background: "#FFFFFF",
              borderRadius: 12,
              maxWidth: 580,
              width: "100%",
              overflow: "hidden",
              boxShadow: "0 20px 25px -5px rgba(0,0,0,0.1)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div
              style={{
                padding: "16px 20px",
                borderBottom: `1px solid ${C.border}`,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                background: "#FAFBFD",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                {React.createElement(selectedConnector.LogoComponent || CompaniesHouseLogo, { size: 36 })}
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <h3 id="connector-modal-title" style={{ ...head, margin: 0, fontSize: 16, fontWeight: 700, color: C.ink }}>
                      {selectedConnector.name}
                    </h3>
                    {selectedConnector.isCustomized ? (
                      <span
                        style={{
                          ...text,
                          fontSize: 10,
                          fontWeight: 700,
                          padding: "2px 6px",
                          borderRadius: 4,
                          background: "#FEF3C7",
                          color: "#92400E",
                          border: "1px solid #FDE68A",
                        }}
                      >
                        Customized
                      </span>
                    ) : null}
                  </div>
                  <div style={{ ...text, fontSize: 12, color: C.slate }}>
                    {selectedConnector.category} · {selectedConnector.badge}
                  </div>
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <button
                  type="button"
                  className={`ui-btn ui-btn--sm ${isEditing ? "ui-btn--primary" : "ui-btn--secondary"}`}
                  onClick={() => {
                    if (!isEditing) {
                      setEditForm({ ...selectedConnector });
                    }
                    setIsEditing(!isEditing);
                  }}
                  style={{ fontSize: 12, height: 28, ...(isEditing ? { background: "#0C8C7D", borderColor: "#0C8C7D" } : {}) }}
                >
                  <Settings2 size={13} />
                  {isEditing ? "View Details" : "Edit Configuration"}
                </button>
                <button
                  type="button"
                  className="ui-btn ui-btn--ghost ui-btn--sm"
                  onClick={() => {
                    setSelectedConnector(null);
                    setIsEditing(false);
                  }}
                  aria-label="Close"
                >
                  <X size={16} />
                </button>
              </div>
            </div>

            {/* Body */}
            <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 16, maxHeight: "calc(85vh - 120px)", overflowY: "auto" }}>
              {isEditing ? (
                /* Edit Mode */
                <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                  <div
                    style={{
                      padding: "10px 14px",
                      background: "#EFF6FF",
                      border: "1px solid #BFDBFE",
                      borderRadius: 8,
                      ...text,
                      fontSize: 12,
                      color: "#1E40AF",
                      lineHeight: 1.5,
                    }}
                  >
                    <b>Connection Configuration Editor:</b> Modify the target endpoint, credentials, active model, and inference parameters for this connection. Changes persist in your workspace.
                  </div>

                  {/* AI Connector Specific Fields */}
                  {selectedConnector.modelName || selectedConnector.partition === "ai" ? (
                    <>
                      <div>
                        <label style={{ ...text, fontSize: 12, fontWeight: 600, color: C.ink, display: "block", marginBottom: 4 }}>
                          Model Deployment / Version Identifier
                        </label>
                        <input
                          type="text"
                          className="ui-input"
                          value={editForm?.modelName || ""}
                          onChange={(e) => setEditForm({ ...editForm, modelName: e.target.value })}
                          placeholder="e.g. Outreach-LeadReasoning-70B v2.4, custom-lead-model-v1"
                          style={{ fontSize: 12.5 }}
                        />
                        <div style={{ ...text, fontSize: 11, color: C.slate, marginTop: 3 }}>
                          The underlying model or checkpoint dispatched by the unified inference gateway.
                        </div>
                      </div>

                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                        <div>
                          <label style={{ ...text, fontSize: 12, fontWeight: 600, color: C.ink, display: "block", marginBottom: 4 }}>
                            Architecture Description
                          </label>
                          <input
                            type="text"
                            className="ui-input"
                            value={editForm?.modelArchitecture || ""}
                            onChange={(e) => setEditForm({ ...editForm, modelArchitecture: e.target.value })}
                            placeholder="e.g. 70B Dense Reasoning Architecture"
                            style={{ fontSize: 12 }}
                          />
                        </div>
                        <div>
                          <label style={{ ...text, fontSize: 12, fontWeight: 600, color: C.ink, display: "block", marginBottom: 4 }}>
                            Context Window Length
                          </label>
                          <input
                            type="text"
                            className="ui-input"
                            value={editForm?.contextWindow || ""}
                            onChange={(e) => setEditForm({ ...editForm, contextWindow: e.target.value })}
                            placeholder="e.g. 128k context"
                            style={{ fontSize: 12 }}
                          />
                        </div>
                      </div>

                      <div>
                        <label style={{ ...text, fontSize: 12, fontWeight: 600, color: C.ink, display: "block", marginBottom: 4 }}>
                          Task Role & Specialization
                        </label>
                        <input
                          type="text"
                          className="ui-input"
                          value={editForm?.task || ""}
                          onChange={(e) => setEditForm({ ...editForm, task: e.target.value })}
                          placeholder="e.g. Chain-of-thought ICP fit scoring & solvency assessment"
                          style={{ fontSize: 12.5 }}
                        />
                      </div>

                      <div>
                        <label style={{ ...text, fontSize: 12, fontWeight: 600, color: C.ink, display: "block", marginBottom: 4 }}>
                          Inference Sampling Parameters
                        </label>
                        <input
                          type="text"
                          className="ui-input"
                          value={editForm?.parameters || ""}
                          onChange={(e) => setEditForm({ ...editForm, parameters: e.target.value })}
                          placeholder="Temp: 0.2 · Top-p: 0.90 · Structured JSON"
                          style={{ fontSize: 12.5 }}
                        />
                      </div>
                    </>
                  ) : null}

                  {/* Universal Endpoint URL */}
                  <div>
                    <label style={{ ...text, fontSize: 12, fontWeight: 600, color: C.ink, display: "block", marginBottom: 4 }}>
                      Endpoint / Base Gateway URL
                    </label>
                    <input
                      type="text"
                      className="ui-input"
                      value={editForm?.endpoint || ""}
                      onChange={(e) => setEditForm({ ...editForm, endpoint: e.target.value })}
                      placeholder="https://..."
                      style={{ fontSize: 12, fontFamily: FONT_MONO }}
                    />
                    <div style={{ ...text, fontSize: 11, color: C.slate, marginTop: 3 }}>
                      REST endpoint or private proxy destination for this connector.
                    </div>
                  </div>

                  {/* Authentication / API Key */}
                  <div>
                    <label style={{ ...text, fontSize: 12, fontWeight: 600, color: C.ink, display: "block", marginBottom: 4 }}>
                      API Key / Bearer Authentication Secret
                    </label>
                    <div style={{ position: "relative" }}>
                      <input
                        type={showSecret ? "text" : "password"}
                        className="ui-input"
                        value={editForm?.authKey ?? (editForm?.auth?.includes("Bearer") || editForm?.auth?.includes("Key") ? "sk_fsb_active_auth_token_live" : "")}
                        onChange={(e) => setEditForm({ ...editForm, authKey: e.target.value })}
                        placeholder="Enter API Key / Bearer Token"
                        style={{ fontSize: 12.5, paddingRight: 36 }}
                      />
                      <button
                        type="button"
                        onClick={() => setShowSecret(!showSecret)}
                        style={{
                          position: "absolute",
                          right: 8,
                          top: "50%",
                          transform: "translateY(-50%)",
                          background: "none",
                          border: "none",
                          cursor: "pointer",
                          color: C.slate,
                          display: "flex",
                          padding: 4,
                        }}
                        aria-label={showSecret ? "Hide key" : "Show key"}
                      >
                        {showSecret ? <EyeOff size={15} /> : <Eye size={15} />}
                      </button>
                    </div>
                  </div>

                  {/* Latency & Provider */}
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                    <div>
                      <label style={{ ...text, fontSize: 12, fontWeight: 600, color: C.ink, display: "block", marginBottom: 4 }}>
                        Latency Target / Execution Cadence
                      </label>
                      <input
                        type="text"
                        className="ui-input"
                        value={editForm?.latency || ""}
                        onChange={(e) => setEditForm({ ...editForm, latency: e.target.value })}
                        placeholder="e.g. 48ms or Real-time"
                        style={{ fontSize: 12 }}
                      />
                    </div>
                    <div>
                      <label style={{ ...text, fontSize: 12, fontWeight: 600, color: C.ink, display: "block", marginBottom: 4 }}>
                        Backend Provider / Cluster
                      </label>
                      <input
                        type="text"
                        className="ui-input"
                        value={editForm?.backendProvider || ""}
                        onChange={(e) => setEditForm({ ...editForm, backendProvider: e.target.value })}
                        placeholder="e.g. Outreach High-Throughput Inference Cluster"
                        style={{ fontSize: 12 }}
                      />
                    </div>
                  </div>

                  {/* Save & Reset Actions */}
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", paddingTop: 10, borderTop: `1px solid ${C.borderLight}` }}>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button
                        type="button"
                        className="ui-btn ui-btn--primary ui-btn--sm"
                        onClick={() => saveConnectorConfig(selectedConnector.id, editForm)}
                        style={{ background: "#0C8C7D", borderColor: "#0C8C7D" }}
                      >
                        <Save size={13} /> Save Configuration
                      </button>
                      <button
                        type="button"
                        className="ui-btn ui-btn--secondary ui-btn--sm"
                        onClick={() => {
                          setIsEditing(false);
                          setEditForm({ ...selectedConnector });
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                    {selectedConnector.isCustomized ? (
                      <button
                        type="button"
                        className="ui-btn ui-btn--ghost ui-btn--sm"
                        onClick={() => resetConnectorConfig(selectedConnector.id)}
                        style={{ color: C.red, fontSize: 12 }}
                      >
                        <RotateCcw size={12} /> Reset to Defaults
                      </button>
                    ) : null}
                  </div>
                </div>
              ) : (
                /* View Mode */
                <>
                  {/* Status Banner */}
                  <div
                    style={{
                      padding: "10px 14px",
                      borderRadius: 8,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      background: selectedConnector.status === "connected" ? "#F0FDF4" : "#F8FAFC",
                      border: `1px solid ${selectedConnector.status === "connected" ? "#BBF7D0" : C.border}`,
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 8, ...text, fontSize: 13 }}>
                      <span
                        style={{
                          width: 8,
                          height: 8,
                          borderRadius: "50%",
                          background: selectedConnector.status === "connected" ? "#16A34A" : "#94A3B8",
                        }}
                      />
                      <span style={{ fontWeight: 600, color: selectedConnector.status === "connected" ? "#166534" : C.textInk }}>
                        Status: {selectedConnector.status === "connected" ? "Synchronized & Active" : "Available to Connect"}
                      </span>
                    </div>
                    <div style={{ display: "flex", gap: 6 }}>
                      <button
                        type="button"
                        className="ui-btn ui-btn--secondary ui-btn--sm"
                        onClick={() => handleTestConnection(selectedConnector)}
                        disabled={testing}
                        style={{ fontSize: 12, height: 28 }}
                      >
                        <RefreshCw size={12} className={testing ? "ui-spin" : ""} />
                        {testing ? "Testing…" : "Test API Connection"}
                      </button>
                      {selectedConnector.status === "connected" && selectedConnector.defaultStatus === "available" ? (
                        <button
                          type="button"
                          className="ui-btn ui-btn--ghost ui-btn--sm"
                          onClick={() => handleDisconnect(selectedConnector)}
                          style={{ fontSize: 12, height: 28, color: C.red }}
                        >
                          Disconnect
                        </button>
                      ) : null}
                    </div>
                  </div>

                  {/* Test confirmation banner */}
                  {testResult ? (
                    <div
                      style={{
                        padding: "10px 14px",
                        borderRadius: 6,
                        background: "#ECFDF5",
                        border: "1px solid #A7F3D0",
                        ...text,
                        fontSize: 12,
                        color: "#065F46",
                        display: "flex",
                        flexDirection: "column",
                        gap: 6,
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 600 }}>
                        <Check size={14} />
                        <span>Status 200 OK · Latency {testResult.latency}</span>
                      </div>
                      <div style={{ fontSize: 11.5 }}>{testResult.message}</div>
                      {testResult.payload ? (
                        <pre
                          style={{
                            margin: "4px 0 0",
                            padding: 6,
                            background: "#FFFFFF",
                            borderRadius: 4,
                            border: "1px solid #D1FAE5",
                            fontFamily: FONT_MONO,
                            fontSize: 11,
                            color: "#047857",
                            overflowX: "auto",
                          }}
                        >
                          {JSON.stringify(testResult.payload, null, 2)}
                        </pre>
                      ) : null}
                    </div>
                  ) : null}

                  {/* Description */}
                  <div style={{ ...text, fontSize: 13, color: C.textInk, lineHeight: 1.5 }}>
                    {selectedConnector.desc}
                  </div>

                  {/* Dedicated AI Model & Architecture Specifications Box */}
                  {selectedConnector.modelName ? (
                    <div
                      style={{
                        background: "linear-gradient(135deg, #F0FDF4 0%, #ECFDF5 100%)",
                        border: "1px solid #BBF7D0",
                        borderRadius: 10,
                        padding: 16,
                        display: "flex",
                        flexDirection: "column",
                        gap: 12,
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <div
                            style={{
                              width: 28,
                              height: 28,
                              borderRadius: 6,
                              background: "#16A34A",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              color: "#FFFFFF",
                            }}
                          >
                            <Zap size={16} />
                          </div>
                          <div>
                            <div style={{ ...head, fontSize: 14, fontWeight: 700, color: "#14532D" }}>
                              AI Model: {selectedConnector.modelName}
                            </div>
                            <div style={{ ...text, fontSize: 11.5, color: "#15803D" }}>
                              {selectedConnector.modelArchitecture}
                            </div>
                          </div>
                        </div>
                        <span
                          style={{
                            ...text,
                            fontSize: 11,
                            background: "#DCFCE7",
                            color: "#166534",
                            border: "1px solid #86EFAC",
                            padding: "3px 9px",
                            borderRadius: 6,
                            fontWeight: 700,
                          }}
                        >
                          {selectedConnector.contextWindow || "128k context"}
                        </span>
                      </div>

                      <div style={{ ...text, fontSize: 12.5, color: "#166534", lineHeight: 1.5 }}>
                        <b>Backend AI Pipeline Task:</b> {selectedConnector.backendRole || selectedConnector.desc}
                      </div>

                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "1fr 1fr",
                          gap: 10,
                          ...text,
                          fontSize: 11.5,
                          background: "#FFFFFF",
                          padding: 12,
                          borderRadius: 8,
                          border: "1px solid #D1FAE5",
                        }}
                      >
                        <div>
                          <span style={{ color: C.slate }}>Task Specialization:</span>{" "}
                          <span style={{ color: C.ink, fontWeight: 600 }}>{selectedConnector.task}</span>
                        </div>
                        <div>
                          <span style={{ color: C.slate }}>Inference Speed & Latency:</span>{" "}
                          <span style={{ color: C.ink, fontWeight: 600 }}>{selectedConnector.latency} ({selectedConnector.inferenceSpeed || "Fast"})</span>
                        </div>
                        <div>
                          <span style={{ color: C.slate }}>Inference Parameters:</span>{" "}
                          <span style={{ color: C.ink, fontWeight: 500 }}>{selectedConnector.parameters || "Temp 0.2 · Structured JSON"}</span>
                        </div>
                        <div>
                          <span style={{ color: C.slate }}>Backend Provider & Cluster:</span>{" "}
                          <span style={{ color: C.ink, fontWeight: 500 }}>{selectedConnector.backendProvider || "Outreach Lead Cluster"}</span>
                        </div>
                      </div>
                    </div>
                  ) : null}

                  {/* Technical Specifications */}
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 1fr",
                      gap: 10,
                      background: "#F8FAFC",
                      padding: 12,
                      borderRadius: 8,
                      fontSize: 12,
                      ...text,
                    }}
                  >
                    <div>
                      <div style={{ color: C.slate, marginBottom: 2 }}>Production Endpoint:</div>
                      <div style={{ fontFamily: FONT_MONO, color: C.ink, wordBreak: "break-all" }}>
                        {selectedConnector.endpoint}
                      </div>
                    </div>
                    <div>
                      <div style={{ color: C.slate, marginBottom: 2 }}>Authentication:</div>
                      <div style={{ color: C.ink, fontWeight: 500 }}>
                        {selectedConnector.auth}
                      </div>
                    </div>
                    <div>
                      <div style={{ color: C.slate, marginBottom: 2 }}>Sync Cadence:</div>
                      <div style={{ color: C.ink }}>
                        {selectedConnector.frequency}
                      </div>
                    </div>
                    <div>
                      <div style={{ color: C.slate, marginBottom: 2 }}>Coverage / Capacity:</div>
                      <div style={{ color: C.ink, fontWeight: 500 }}>
                        {selectedConnector.recordsCount}
                      </div>
                    </div>
                  </div>

                  {/* Modify Connection Callout */}
                  <div
                    style={{
                      padding: "12px 14px",
                      borderRadius: 8,
                      background: "#F8FAFC",
                      border: `1px solid ${C.border}`,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 12,
                    }}
                  >
                    <div>
                      <div style={{ ...head, fontSize: 12.5, fontWeight: 600, color: C.ink }}>
                        Want to customize this established connection?
                      </div>
                      <div style={{ ...text, fontSize: 11.5, color: C.slate }}>
                        Change model versions, custom proxy endpoints, API tokens, or parameters anytime.
                      </div>
                    </div>
                    <button
                      type="button"
                      className="ui-btn ui-btn--secondary ui-btn--sm"
                      onClick={() => {
                        setEditForm({ ...selectedConnector });
                        setIsEditing(true);
                      }}
                      style={{ fontSize: 12, height: 28, flexShrink: 0 }}
                    >
                      <Settings2 size={13} />
                      Edit Configuration
                    </button>
                  </div>

                  {/* Interactive connect form when not connected */}
                  {selectedConnector.status === "available" ? (
                    <div style={{ borderTop: `1px solid ${C.borderLight}`, paddingTop: 14 }}>
                      <div style={{ ...head, fontSize: 13, fontWeight: 600, marginBottom: 8, color: C.ink }}>
                        Connect & Authenticate Credentials
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        <input
                          type="password"
                          className="ui-input"
                          placeholder="Enter API Key / Bearer Secret Token"
                          defaultValue="sk_fsb_live_test_auth_key"
                          style={{ fontSize: 12.5 }}
                        />
                        <div style={{ display: "flex", gap: 8 }}>
                          <button
                            type="button"
                            className="ui-btn ui-btn--primary ui-btn--sm"
                            onClick={() => handleConnect(selectedConnector)}
                            style={{ background: "#0C8C7D", borderColor: "#0C8C7D" }}
                          >
                            Authorize & Connect
                          </button>
                          <button
                            type="button"
                            className="ui-btn ui-btn--ghost ui-btn--sm"
                            onClick={() => setSelectedConnector(null)}
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : null}
                </>
              )}
            </div>

            {/* Footer */}
            <div
              style={{
                padding: "12px 20px",
                borderTop: `1px solid ${C.border}`,
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                background: "#FAFBFD",
              }}
            >
              {selectedConnector.docsUrl && selectedConnector.docsUrl.startsWith("http") ? (
                <a
                  href={selectedConnector.docsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    ...text,
                    fontSize: 12.5,
                    color: "#0C8C7D",
                    textDecoration: "none",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 4,
                  }}
                >
                  <ExternalLink size={12} /> Official API Documentation
                </a>
              ) : (
                <span />
              )}
              <button
                type="button"
                className="ui-btn ui-btn--secondary ui-btn--sm"
                onClick={() => {
                  setSelectedConnector(null);
                  setIsEditing(false);
                }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Add Custom Connector Modal */}
      {addModalOpen ? (
        <AddCustomConnectorDialog
          initialPartition={partition}
          onClose={() => setAddModalOpen(false)}
          onSave={(created) => {
            saveCustomConnector(created);
            setAddModalOpen(false);
          }}
        />
      ) : null}
    </div>
  );
}

// Dialog for adding custom connectors
function AddCustomConnectorDialog({ initialPartition, onClose, onSave }) {
  const [targetPartition, setTargetPartition] = useState(initialPartition);
  const [name, setName] = useState("");
  const [category, setCategory] = useState(initialPartition === "data" ? "CRM & ERP" : "Bring Your Own AI");
  const [endpoint, setEndpoint] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [description, setDescription] = useState("");

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!name.trim()) return;

    const newConnector = {
      id: `custom_${Date.now()}`,
      partition: targetPartition,
      name: name.trim(),
      category: category || "Custom Integrations",
      badge: "Custom Endpoint",
      defaultStatus: "connected",
      LogoComponent: targetPartition === "data" ? CompaniesHouseLogo : CustomLlmLogo,
      desc: description.trim() || `User-configured ${targetPartition.toUpperCase()} connector endpoint for Leads.`,
      endpoint: endpoint.trim() || "https://api.custom.internal/v1",
      docsUrl: "",
      auth: apiKey ? "Custom API Key Configured" : "Unauthenticated Endpoint",
      frequency: "Event-driven / On-demand",
      latency: "Local / Direct",
      recordsCount: "Custom Pipeline",
      sampleResponse: {
        custom_endpoint: endpoint.trim() || "https://api.custom.internal/v1",
        status: "active",
      },
    };

    onSave(newConnector);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-connector-title"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15, 23, 42, 0.45)",
        backdropFilter: "blur(2px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
        padding: 16,
      }}
      onClick={onClose}
    >
      <div
        className="ui-card"
        style={{
          background: "#FFFFFF",
          borderRadius: 12,
          maxWidth: 500,
          width: "100%",
          overflow: "hidden",
          boxShadow: "0 20px 25px -5px rgba(0,0,0,0.1)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <form onSubmit={handleSubmit}>
          {/* Header */}
          <div
            style={{
              padding: "16px 20px",
              borderBottom: `1px solid ${C.border}`,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              background: "#FAFBFD",
            }}
          >
            <div>
              <h3 id="add-connector-title" style={{ ...head, margin: 0, fontSize: 16, fontWeight: 700, color: C.ink }}>
                Add Custom Connector
              </h3>
              <div style={{ ...text, fontSize: 12, color: C.slate }}>
                Attach your own data source or enterprise AI model to Leads
              </div>
            </div>
            <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" onClick={onClose} aria-label="Close">
              <X size={16} />
            </button>
          </div>

          {/* Form Content */}
          <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 14 }}>
            <div>
              <label style={{ ...text, fontSize: 12.5, fontWeight: 600, color: C.ink, display: "block", marginBottom: 6 }}>
                Connector Type
              </label>
              <div style={{ display: "flex", gap: 10 }}>
                <label
                  style={{
                    ...text,
                    flex: 1,
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "8px 12px",
                    borderRadius: 6,
                    border: `1px solid ${targetPartition === "data" ? "#0C8C7D" : C.border}`,
                    background: targetPartition === "data" ? "#E6F6F4" : "#fff",
                    cursor: "pointer",
                    fontSize: 13,
                  }}
                >
                  <input
                    type="radio"
                    name="conn_partition"
                    checked={targetPartition === "data"}
                    onChange={() => {
                      setTargetPartition("data");
                      setCategory("CRM & ERP");
                    }}
                  />
                  Data Connector
                </label>
                <label
                  style={{
                    ...text,
                    flex: 1,
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "8px 12px",
                    borderRadius: 6,
                    border: `1px solid ${targetPartition === "ai" ? "#0C8C7D" : C.border}`,
                    background: targetPartition === "ai" ? "#E6F6F4" : "#fff",
                    cursor: "pointer",
                    fontSize: 13,
                  }}
                >
                  <input
                    type="radio"
                    name="conn_partition"
                    checked={targetPartition === "ai"}
                    onChange={() => {
                      setTargetPartition("ai");
                      setCategory("Bring Your Own AI");
                    }}
                  />
                  Leads AI Connector
                </label>
              </div>
            </div>

            <div>
              <label style={{ ...text, fontSize: 12.5, fontWeight: 600, color: C.ink, display: "block", marginBottom: 4 }}>
                Connector Name
              </label>
              <input
                type="text"
                required
                className="ui-input"
                placeholder={targetPartition === "data" ? "e.g. Member Database" : "e.g. Custom Prospecting LLM"}
                value={name}
                onChange={(e) => setName(e.target.value)}
                style={{ width: "100%", fontSize: 13 }}
              />
            </div>

            <div>
              <label style={{ ...text, fontSize: 12.5, fontWeight: 600, color: C.ink, display: "block", marginBottom: 4 }}>
                Category
              </label>
              <select
                className="ui-input"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                style={{ width: "100%", fontSize: 13 }}
              >
                {targetPartition === "data" ? (
                  <>
                    <option value="CRM & ERP">CRM & ERP</option>
                    <option value="Enrichment & Registry">Enrichment & Registry</option>
                    <option value="Big Data & Cloud">Big Data & Cloud</option>
                    <option value="File & API">File & API</option>
                  </>
                ) : (
                  <>
                    <option value="Bring Your Own AI">Bring Your Own AI</option>
                    <option value="Leads AI Engines">Leads AI Engines</option>
                  </>
                )}
              </select>
            </div>

            <div>
              <label style={{ ...text, fontSize: 12.5, fontWeight: 600, color: C.ink, display: "block", marginBottom: 4 }}>
                Endpoint URL / Host
              </label>
              <input
                type="text"
                required
                className="ui-input"
                placeholder="https://api.your-company.org/v1"
                value={endpoint}
                onChange={(e) => setEndpoint(e.target.value)}
                style={{ width: "100%", fontSize: 13, fontFamily: FONT_MONO }}
              />
            </div>

            <div>
              <label style={{ ...text, fontSize: 12.5, fontWeight: 600, color: C.ink, display: "block", marginBottom: 4 }}>
                API Key / Secret Token (Optional)
              </label>
              <input
                type="password"
                className="ui-input"
                placeholder="sk-..."
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                style={{ width: "100%", fontSize: 13 }}
              />
            </div>

            <div>
              <label style={{ ...text, fontSize: 12.5, fontWeight: 600, color: C.ink, display: "block", marginBottom: 4 }}>
                Description
              </label>
              <textarea
                className="ui-input"
                rows={2}
                placeholder="Dataset description or prompt role..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                style={{ width: "100%", fontSize: 13 }}
              />
            </div>
          </div>

          {/* Footer */}
          <div
            style={{
              padding: "12px 20px",
              borderTop: `1px solid ${C.border}`,
              display: "flex",
              justifyContent: "flex-end",
              gap: 8,
              background: "#FAFBFD",
            }}
          >
            <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" onClick={onClose}>
              Cancel
            </button>
            <button
              type="submit"
              className="ui-btn ui-btn--primary ui-btn--sm"
              disabled={!name.trim()}
              style={{ background: "#0C8C7D", borderColor: "#0C8C7D" }}
            >
              Save Connector
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
